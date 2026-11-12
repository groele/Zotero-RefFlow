import { actionIcon } from "./cardActionIcon";
import { config } from "../../package.json";
import { getString } from "../utils/locale";
import type Views from "./views";
import type TipUI from "./tip";
import { JournalCommitPendingError, JournalUnavailableError } from "./batchJournal";
import { importFailureText, importErrorText, importSummaryText } from "./importErrors";
import { navigateToPdfReference } from "./readerNavigation";
import type BatchResults from "./batchResults";

export interface CardRowContext {
  views: Views;
  body: HTMLElement;
  virtual: boolean;
  rowHeight: number;
  batchResults: BatchResults;
  selected: Set<ItemBaseInfo>;
  rows: HTMLElement[];
  refs: ItemBaseInfo[];
  getTip: () => TipUI | undefined;
  setTip: (tip: TipUI | undefined) => void;
  clearTip: () => void;
  setHoverTimer: (timer: ReturnType<typeof globalThis.setTimeout> | undefined) => void;
  getHoverTimer: () => ReturnType<typeof globalThis.setTimeout> | undefined;
  select: (index: number, event: MouseEvent | KeyboardEvent) => void;
  open: (ref: ItemBaseInfo) => void;
  filtered: () => ItemBaseInfo[];
  visible: () => HTMLElement[];
  updateSelection: () => void;
  showJournal: () => void;
  label: () => HTMLElement;
  invalidateLibraryMatches: () => void;
  parent: () => Zotero.Item;
  onVirtualJump: (refNext: ItemBaseInfo, focus: () => void) => void;
}

/** Build one card; handlers read live row.reference so virtual windows can remount safely. */
export function createReferenceCardRow(
  ctx: CardRowContext,
  ref: ItemBaseInfo,
  number: number,
  posInSet: number,
  setSize: number,
  current: () => boolean,
): HTMLElement {
  const parent = ctx.parent();
  const doc = ctx.body.ownerDocument;
  const row = doc.createElement("div");
  row.className = "reference-item";
  row.tabIndex = 0;
  row.setAttribute("role", "option");
  row.setAttribute("aria-selected", "false");
  (row as any).reference = ref;
  if (ctx.virtual) {
    Object.assign(row.style, {
      height: `${ctx.rowHeight}px`,
      flexShrink: "0",
      boxSizing: "border-box",
      overflow: "hidden",
    });
  }
  row.setAttribute("aria-posinset", String(posInSet));
  row.setAttribute("aria-setsize", String(setSize));

  const citation = doc.createElement("div");
  citation.className = "reference-citation";
  const marker = doc.createElement("div");
  marker.className = "reference-marker";
  const numberNode = doc.createElement("span");
  numberNode.className = "reference-number";
  numberNode.textContent = `${number}.`;
  numberNode.title = ref.page
    ? getString("cards-locate-in-pdf", { args: { page: ref.page } })
    : `${getString("cards-number-label")} ${number}`;
  if (ref.page) {
    numberNode.style.cursor = "pointer";
    numberNode.addEventListener("click", (ev) => {
      ev.stopPropagation();
      void navigateToPdfReference(ctx.views, ctx.parent(), (row as any).reference, ctx.body.ownerDocument.defaultView!);
    });
  }
  row.dataset.referenceNumber = String(number);
  row.setAttribute("aria-label", `${numberNode.title}: ${ref.title || ref.text || ""}`);

  const dot = doc.createElement("span");
  dot.className = "reference-state";
  const age = Math.max(0, new Date().getFullYear() - Number(ref.year || 2000));
  dot.style.backgroundColor = ref._item
    ? "var(--color-accent, #3678b5)"
    : `hsl(210 30% ${Math.min(85, 40 + age * 2)}%)`;
  dot.title = ref._item ? getString("cards-in-library") : String(ref.year || "");

  const content = doc.createElement("div");
  content.className = "reference-description";
  const heading = doc.createElement("div");
  heading.className = "reference-heading";
  const text = doc.createElement("span");
  text.className = "reference-text";
  text.textContent = ref.text || ref.title || "";
  text.title = text.textContent || "";
  const title = doc.createElement("strong");
  title.className = "reference-title";
  title.textContent = ref.title || ref.text || "";
  title.title = title.textContent || "";
  const clamp = (node: HTMLElement) => {
    if (!ctx.virtual) return;
    node.style.display = "-webkit-box";
    node.style.setProperty("-webkit-box-orient", "vertical");
    node.style.setProperty("-webkit-line-clamp", "2");
    node.style.overflow = "hidden";
  };
  clamp(title);
  const about = doc.createElement("span");
  about.className = "reference-about";
  const mentions = ref.mentionCount
    ? getString("cards-mentions-badge", { args: { count: ref.mentionCount } })
    : "";
  about.textContent = [
    (ref.authors || []).slice(0, 3).join(" / "),
    ref.year,
    ref.publicationVenue,
    (ref as any).citationCount !== undefined ? `${getString("cards-cited")} ${(ref as any).citationCount}` : "",
    mentions,
  ]
    .filter(Boolean)
    .join(" · ");
  about.title = about.textContent;
  clamp(about);
  const metadata = doc.createElement("div");
  metadata.className = "reference-metadata";
  metadata.append(about);
  metadata.hidden = !about.textContent;
  if (ref.retraction?.isRetracted) {
    const warning = doc.createElement("span");
    warning.className = "reference-retracted";
    warning.textContent = getString("relatedbox-retracted-badge");
    warning.title = ref.retraction.reason || "";
    content.append(warning);
  }

  const editable = Boolean(
    parent &&
      !parent.deleted &&
      (typeof parent.isEditable !== "function" || parent.isEditable()) &&
      (Zotero as any).Libraries.get(parent.libraryID)?.editable !== false,
  );
  const action = doc.createElement("button");
  action.type = "button";
  action.className = "reference-action";
  actionIcon(
    action,
    ref._item ? "open" : "add",
    getString(ref._item ? "cards-show-library" : editable ? "cards-import" : "cards-library-readonly"),
  );
  if (!ref._item && !editable) action.disabled = true;
  action.addEventListener("dblclick", (event) => event.stopPropagation());
  action.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (action.disabled || !current() || !row.isConnected) return;
    const liveRef = (row as any).reference as ItemBaseInfo;
    const host = ctx.parent();
    if (!host || host.deleted) return;
    const collections = ctx.views.utils.importCollections(host, ctx.body.ownerDocument.defaultView!);
    const active = () => current() && row.isConnected && ctx.parent()?.id === host.id;
    action.disabled = true;
    action.setAttribute("aria-busy", "true");
    row.dataset.importRevision = String(Number(row.dataset.importRevision || 0) + 1);
    actionIcon(action, "busy", getString("cards-importing-doi"));
    try {
      const found = await ctx.views.utils.searchLibraryItem({ ...liveRef, _item: undefined }, host.libraryID);
      if (!active()) return;
      if (found) {
        liveRef._item = found;
        await ctx.views.utils.selectItemInLibrary(found, ctx.body.ownerDocument.defaultView!);
      } else {
        const result = await ctx.batchResults.run(
          host,
          [liveRef],
          {
            owner: ctx.body,
            collections,
            downloadOA: false,
            createSubCollection: false,
            createManifestNote: false,
            resolveMissingDOI: true,
          },
          [ctx.refs.indexOf(liveRef) + 1],
        );
        if (result.cancelled) throw new Error(getString("cards-import-cancelled"));
        if (result.failedCount) throw new Error(importFailureText(result.failures[0]));
        if (active()) ctx.label().textContent = importSummaryText(result);
      }
      if (active() && liveRef._item) {
        actionIcon(action, "open", getString("cards-show-library"));
        dot.style.backgroundColor = "var(--color-accent, #3678b5)";
        dot.title = getString("cards-in-library");
        row.style.opacity = "1";
        ctx.invalidateLibraryMatches();
      }
    } catch (error) {
      if (error instanceof JournalCommitPendingError || error instanceof JournalUnavailableError) void ctx.showJournal();
      if (active()) {
        const message = importErrorText(error);
        ctx.label().textContent = message;
        actionIcon(action, "error", message);
      }
      ztoolkit.log(error);
    } finally {
      row.dataset.importRevision = String(Number(row.dataset.importRevision || 0) + 1);
      action.disabled = false;
      action.removeAttribute("aria-busy");
    }
  });
  action.setAttribute("aria-label", action.title);
  row.style.opacity = ref._item
    ? "1"
    : String(Zotero.Prefs.get(`${config.addonRef}.notInLibarayOpacity`) || "1");

  title.addEventListener("mouseenter", () => {
    if (!Zotero.Prefs.get(`${config.addonRef}.isShowTip`)) return;
    globalThis.clearTimeout(ctx.getHoverTimer());
    ctx.setHoverTimer(
      globalThis.setTimeout(() => {
        if (!current() || !row.isConnected) return;
        const live = (row as any).reference as ItemBaseInfo;
        ctx.clearTip();
        ctx.setTip(
          ctx.views.showTipUI(
            title.getBoundingClientRect() as any,
            { ...live, primaryVenue: live.publicationVenue, identifiers: live.identifiers || {} } as any,
            "left",
            live.identifiers?.DOI,
            true,
            ctx.body.ownerDocument.defaultView!,
          ),
        );
      }, Math.max(100, Math.min(2000, Number(Zotero.Prefs.get(`${config.addonRef}.showTipAfterMillisecond`)) || 233))),
    );
  });
  title.addEventListener("mouseleave", () => {
    globalThis.clearTimeout(ctx.getHoverTimer());
    const tip = ctx.getTip();
    if (!tip) return;
    globalThis.clearTimeout(tip.tipTimer);
    tip.tipTimer = globalThis.setTimeout(() => {
      if (ctx.getTip() === tip) ctx.clearTip();
    }, tip.removeTipAfterMillisecond);
  });

  marker.append(numberNode);
  citation.append(marker, text);
  heading.append(dot, title, action);
  content.append(heading, metadata);
  row.append(citation, content);

  row.addEventListener("click", (event) => ctx.select(ctx.refs.indexOf((row as any).reference), event));
  row.addEventListener("dblclick", () => ctx.open((row as any).reference));
  row.addEventListener("contextmenu", (event) => {
    const live = (row as any).reference as ItemBaseInfo;
    if (!ctx.selected.has(live)) ctx.select(ctx.refs.indexOf(live), event);
  });
  row.addEventListener("keydown", (event) => {
    if (event.target !== row) return;
    const live = (row as any).reference as ItemBaseInfo;
    const liveIndex = ctx.refs.indexOf(live);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      for (const item of ctx.filtered()) ctx.selected.add(item);
      ctx.updateSelection();
    } else if (event.key === "Enter") {
      event.preventDefault();
      ctx.open(live);
    } else if (event.key === "Escape") {
      event.preventDefault();
      ctx.selected.clear();
      ctx.updateSelection();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
      event.preventDefault();
      const subset = ctx.selected.size ? [...ctx.selected] : ctx.filtered();
      ctx.views.utils.copyText(subset.map((item) => item.text || item.title).join("\n"), false);
    } else if (event.key === " ") {
      event.preventDefault();
      ctx.select(liveIndex, event);
    } else if (["ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
      event.preventDefault();
      const visible = ctx.virtual ? ctx.filtered() : ctx.visible().map((node) => (node as any).reference);
      const grid = row.parentElement as HTMLElement | null;
      const viewport = Math.min(grid?.clientHeight || ctx.rowHeight * 4, (doc.defaultView?.innerHeight || 600) * 0.65);
      const height = ctx.virtual ? ctx.rowHeight : Math.max(1, row.getBoundingClientRect().height);
      const page = Math.max(1, Math.floor(viewport / height));
      const position = visible.indexOf(live);
      const delta =
        event.key === "Home"
          ? -position
          : event.key === "End"
            ? visible.length - 1 - position
            : event.key === "PageDown"
              ? page
              : event.key === "PageUp"
                ? -page
                : event.key === "ArrowDown"
                  ? 1
                  : -1;
      const refNext = visible[Math.max(0, Math.min(visible.length - 1, position + delta))];
      if (!refNext) return;
      const focus = () => {
        const next = ctx.rows.find((node) => (node as any).reference === refNext);
        if (next) {
          next.focus({ preventScroll: true });
          next.scrollIntoView({ block: "nearest" });
          ctx.select(ctx.refs.indexOf(refNext), event);
        }
      };
      if (ctx.virtual && !ctx.rows.some((node) => (node as any).reference === refNext)) ctx.onVirtualJump(refNext, focus);
      else focus();
    }
  });
  return row;
}
