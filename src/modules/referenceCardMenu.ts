import { config } from "../../package.json";
import { getString } from "../utils/locale";
import type Views from "./views";
import BatchImporter from "./batchImporter";
import { JournalCommitPendingError, JournalUnavailableError } from "./batchJournal";
import { importFailureText, importErrorText, importSummaryText } from "./importErrors";
import { navigateToPdfReference } from "./readerNavigation";

export type CardFilterMode = "all" | "unimported" | "imported" | "oa" | "retracted";

export interface ReferenceCardMenuContext {
  views: Views;
  body: HTMLElement;
  menus: Set<Element>;
  parent: () => Zotero.Item;
  subset: () => ItemBaseInfo[];
  all: () => ItemBaseInfo[];
  selectedCount: () => number;
  label: () => HTMLElement;
  journalStatus: { show: () => void };
  batchResults: { clear: () => void; run: Function };
  invalidateLibraryMatches: () => void;
  openRef: (ref: ItemBaseInfo) => void;
  getFilterMode: () => CardFilterMode;
  setFilterMode: (mode: CardFilterMode) => void;
  isDisposed: () => boolean;
}

/**
 * Builds and opens the right-click context menu for the reference cards list.
 */
export function openReferenceCardMenu(ctx: ReferenceCardMenuContext, event?: MouseEvent): void {
  if (ctx.isDisposed()) return;
  const parentAtOpen = ctx.parent();
  const refsAtOpen = ctx.subset();
  const allAtOpen = ctx.all();
  const hasSelectionAtOpen = ctx.selectedCount() > 0;
  const firstSelectedRef = refsAtOpen[0];
  const collectionsAtOpen = ctx.views.utils.importCollections(parentAtOpen, ctx.body.ownerDocument.defaultView!);
  const samePanel = () => !ctx.isDisposed() && ctx.body.isConnected && Number(ctx.body.getAttribute("data-refflow-item-id")) === parentAtOpen.id;
  const doc: any = ctx.body.ownerDocument;
  const popup = doc.createXULElement("menupopup") as any;
  popup.setAttribute("data-refflow-menu", "references");

  const actionKeys: Record<string, string> = {
    "cards-copy-text": "copy-text",
    "cards-copy-doi": "copy-doi",
    "cards-copy-url": "copy-url",
    "cards-open": "open",
    "cards-import-selected": "import-selected",
    "cards-import-all": "import-all",
    "relatedbox-rollback": "rollback"
  };
  const enabled = (key: string) => !actionKeys[key] || Zotero.Prefs.get(`${config.addonRef}.quickAction.${actionKeys[key]}`) !== false;
  let target = popup;
  const editableAtOpen = Boolean(parentAtOpen && !parentAtOpen.deleted && (typeof parentAtOpen.isEditable !== "function" || parentAtOpen.isEditable()) && ((Zotero as any).Libraries?.get?.(parentAtOpen.libraryID)?.editable !== false));

  const add = (key: string, action: () => any, checked?: boolean, disabled?: boolean, l10nArgs?: any, type: "checkbox" | "radio" = "checkbox") => {
    if (!enabled(key)) return;
    const item = doc.createXULElement("menuitem");
    item.setAttribute("label", l10nArgs ? getString(key, { args: l10nArgs }) : getString(key));
    if (actionKeys[key]) item.setAttribute("data-refflow-quick-action", actionKeys[key]);
    if (checked !== undefined) {
      item.setAttribute("type", type);
      item.checked = checked;
    }
    if (disabled) {
      item.setAttribute("disabled", "true");
      item.disabled = true;
    }
    item.addEventListener("command", () => Promise.resolve().then(() => {
      if (samePanel() && enabled(key) && !disabled) return action();
    }).catch(error => {
      if (samePanel()) {
        ctx.label().textContent = importErrorText(error);
        if (error instanceof JournalCommitPendingError || error instanceof JournalUnavailableError) void ctx.journalStatus.show();
      }
      ztoolkit.log(error);
    }));
    target.append(item);
  };

  const submenu = (key: string) => {
    const menu = doc.createXULElement("menu");
    menu.setAttribute("label", getString(key));
    menu.setAttribute("data-refflow-group", key);
    const child = doc.createXULElement("menupopup");
    menu.append(child);
    menu.addEventListener("command", (ev: Event) => {
      if (ev.target === menu) {
        ev.stopPropagation();
        const first = child.querySelector("menuitem");
        if (first) first.dispatchEvent(new (menu.ownerDocument.defaultView as any).Event("command"));
      }
    });
    popup.append(menu);
    return child;
  };

  target = submenu("cards-menu-copy");
  add("cards-copy-text", () => ctx.views.utils.copyText(refsAtOpen.map(ref => ref.text || ref.title).join("\n"), false));
  add("cards-copy-doi", () => ctx.views.utils.copyText(refsAtOpen.map(ref => ref.identifiers?.DOI).filter(Boolean).join("\n"), false));
  add("cards-copy-url", () => ctx.views.utils.copyText(refsAtOpen.map(ref => ref.url || (ref.identifiers?.DOI ? `https://doi.org/${ref.identifiers.DOI}` : "")).filter(Boolean).join("\n"), false));

  target = popup;
  add("cards-open", () => refsAtOpen.slice(0, 20).forEach(ref => ctx.openRef(ref)));
  if (firstSelectedRef?.page) {
    add("cards-locate-in-pdf", () => navigateToPdfReference(ctx.views, parentAtOpen, firstSelectedRef, ctx.body.ownerDocument.defaultView!), undefined, false, { page: firstSelectedRef.page });
  }

  target = submenu("cards-menu-import");
  const importRefs = async (all: boolean) => {
    const parent = parentAtOpen;
    if (parent && typeof parent.isEditable === "function" && !parent.isEditable()) throw new Error(getString("cards-library-readonly"));
    if (!all && !hasSelectionAtOpen) throw new Error(getString("cards-select-before-import"));
    const chosen = all ? allAtOpen : refsAtOpen;
    if (!chosen.length) return;
    const result = await ctx.batchResults.run(parent, chosen, {
      owner: ctx.body,
      collections: collectionsAtOpen,
      downloadOA: Boolean(Zotero.Prefs.get(`${config.addonRef}.downloadOA`)),
      createSubCollection: true,
      createManifestNote: true,
      resolveMissingDOI: true
    }, chosen.map(ref => allAtOpen.indexOf(ref) + 1));
    if (samePanel()) {
      ctx.invalidateLibraryMatches();
      ctx.label().textContent = (result.cancelled ? getString("cards-import-cancelled") : importSummaryText(result)) + (result.failedCount ? " · " + importFailureText(result.failures[0]) : "");
    }
  };
  add("cards-import-selected", () => importRefs(false), undefined, !editableAtOpen);
  add("cards-import-all", () => importRefs(true), undefined, !editableAtOpen);

  target = popup;
  add("relatedbox-rollback", async () => {
    const parent = parentAtOpen;
    if (parent && typeof parent.isEditable === "function" && !parent.isEditable()) throw new Error(getString("cards-library-readonly"));
    const id = await BatchImporter.latestBatchID(parent).catch(error => {
      ztoolkit.log("Failed to read rollback journal", error);
      throw new Error(getString("cards-rollback-failed"));
    });
    if (id) {
      const count = await ctx.views.rollbackReferences(parent, id);
      if (samePanel()) {
        ctx.batchResults.clear();
        ctx.invalidateLibraryMatches();
        ctx.label().textContent = getString("cards-rollback-summary", { args: { count } });
      }
    }
  }, undefined, !editableAtOpen);

  target = submenu("cards-menu-filter");
  const currentFilter = ctx.getFilterMode();
  for (const [mode, key] of [
    ["all", "cards-filter-all"],
    ["unimported", "cards-filter-unimported"],
    ["imported", "cards-filter-imported"],
    ["oa", "cards-filter-oa"],
    ["retracted", "cards-filter-retracted"]
  ] as const) {
    add(key, () => ctx.setFilterMode(mode), currentFilter === mode, false, undefined, "radio");
  }

  target = submenu("cards-menu-source");
  for (const source of ["Auto", "PDF", "Web", "API"]) {
    add(
      source === "Auto" ? "cards-source-auto" : source === "Web" ? "cards-source-web" : source === "PDF" ? "cards-source-pdf" : "cards-source-online",
      () => {
        if (!samePanel()) return;
        ctx.body.querySelector<HTMLSelectElement>("select")!.value = source;
        ctx.body.querySelector("select")!.dispatchEvent(new (ctx.body.ownerDocument.defaultView as any).Event("change"));
      },
      ctx.body.getAttribute("source") === source
    );
  }

  target = submenu("cards-menu-sort");
  for (const sort of ["Original", "Recency", "Cited Count"]) {
    add(
      sort === "Original" ? "cards-sort-original" : sort === "Recency" ? "cards-sort-recency" : "cards-sort-cited",
      async () => {
        if (!samePanel()) return;
        Zotero.Prefs.set(`${config.addonRef}.sortBy`, sort);
        await ctx.views.sortReferences(ctx.body);
      },
      Zotero.Prefs.get(`${config.addonRef}.sortBy`) === sort
    );
  }

  target = submenu("cards-menu-more");
  add("relatedbox-download-oa", () => Zotero.Prefs.set(`${config.addonRef}.downloadOA`, !Zotero.Prefs.get(`${config.addonRef}.downloadOA`)), Boolean(Zotero.Prefs.get(`${config.addonRef}.downloadOA`)));
  add("cards-journal-inspect", () => ctx.journalStatus.show());

  for (const menu of Array.from(popup.children as HTMLCollectionOf<Element>)) {
    if (menu.localName === "menu" && !menu.querySelector("menuitem")) menu.remove();
  }
  ctx.menus.add(popup);
  popup.addEventListener("popuphidden", (ev: Event) => {
    if (ev.target !== popup) return;
    ctx.menus.delete(popup);
    popup.remove();
  });
  doc.documentElement.append(popup);
  if (event) popup.openPopupAtScreen(event.screenX, event.screenY, true);
  else popup.openPopup(ctx.body.closest("item-pane-custom-section"), "after_end", 0, 0, false, false);
}
