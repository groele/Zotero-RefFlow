import { config } from "../../package.json";
import type Views from "./views";
import { getPanelItem } from "./referencePipeline";

/**
 * Checks whether the given item's type is eligible for automatic local-cache loading on selection.
 */
export function isItemTypeAllowedForAutoCache(item: Zotero.Item): boolean {
  const excluded = String(Zotero.Prefs.get(`${config.addonRef}.notAutoRefreshItemTypes`) || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return !excluded.includes(Zotero.ItemTypes.getName(item.itemTypeID));
}

function findTargetSection(
  doc: Document,
  sidenavButton: Element | undefined,
  headerClickSection: HTMLElement | undefined,
  paneSuffix: string
): HTMLElement | null {
  if (headerClickSection) return headerClickSection;
  const scope =
    sidenavButton?.closest?.("#zotero-context-pane-inner, #zotero-context-pane, #zotero-item-pane") || doc;
  const exactPane = sidenavButton?.getAttribute("data-pane") || "";
  if (exactPane && typeof scope.querySelectorAll === "function") {
    for (const candidate of Array.from(scope.querySelectorAll("item-pane-custom-section") as unknown as Iterable<Element>)) {
      if (candidate?.getAttribute("data-pane") === exactPane) return candidate as HTMLElement;
    }
  }
  return (
    (scope.querySelector?.(`item-pane-custom-section[data-pane$="${paneSuffix}"]`) as HTMLElement | null) ||
    (doc.querySelector?.(`item-pane-custom-section[data-pane$="${paneSuffix}"]`) as HTMLElement | null)
  );
}

function resolvePendingItemID(views: Views, section: HTMLElement, doc: Document): string {
  const existing = section.querySelector?.('[data-type="body"]')?.getAttribute("data-refflow-item-id");
  if (existing) return existing;
  const win = doc.defaultView as any;
  const inContext = Boolean(section.closest?.("#zotero-context-pane-inner, #zotero-context-pane"));
  if (inContext && win) {
    const reader = views.utils.getReader(win);
    const att = reader?.itemID ? (Zotero.Items.get(reader.itemID) || undefined) : undefined;
    const parent = att ? (att.parentItem || att) : undefined;
    if (parent?.id) return String(parent.id);
  }
  const selected = win?.ZoteroPane?.getSelectedItems?.()?.[0];
  const parent = selected?.parentItem || selected;
  return parent?.id ? String(parent.id) : "";
}

/**
 * Binds click/command listeners on the document so clicking the Zotero right-hand
 * sidenav icon (or expanding a collapsed RefFlow section) fetches references via API on demand.
 */
export function bindReferenceSidenavClick(views: Views, doc: Document, signal: AbortSignal): void {
  const paneSuffix = `-${config.addonRef}-references`;
  const onActivate = (event: Event) => {
    if (views.isDisposed()) return;
    if (event.type === "click" && (event as MouseEvent).button !== 0) return;

    const rawPath = typeof (event as any).composedPath === "function" ? (event as any).composedPath() : [event.target];
    let sidenavButton: Element | undefined;
    let headerClickSection: HTMLElement | undefined;
    for (const node of rawPath) {
      if (!node || typeof (node as Element).getAttribute !== "function") continue;
      const el = node as Element;
      const dataPane = el.getAttribute("data-pane") || "";
      if (
        (dataPane === `${config.addonRef}-references` || dataPane.endsWith(paneSuffix)) &&
        el.localName !== "item-pane-custom-section"
      ) {
        sidenavButton = el;
        break;
      }
    }
    if (!sidenavButton && event.type === "click") {
      const target = event.target as Element | null;
      const customSection = target?.closest?.(`item-pane-custom-section[data-pane$="${paneSuffix}"]`) as HTMLElement | null;
      if (
        customSection &&
        !target?.closest?.('[data-type="body"]') &&
        !target?.closest?.('[slot="header-buttons"], .section-buttons, button, toolbarbutton, menupopup')
      ) {
        headerClickSection = customSection;
      }
    }
    if (!sidenavButton && !headerClickSection) return;

    const section = findTargetSection(doc, sidenavButton, headerClickSection, paneSuffix);
    if (!section) return;

    const collapsible = section.querySelector("collapsible-section") as any;
    if (sidenavButton && collapsible && !collapsible.open) {
      (collapsible.wrappedJSObject || collapsible).open = true;
    }

    const triggerFetch = (body: HTMLElement): boolean => {
      if (!(body as any)._cards) return false;
      section.removeAttribute("data-refflow-fetch-requested");
      body.removeAttribute("data-refflow-fetch-requested");
      const currentType = body.getAttribute("data-refflow-type") || "References";
      if ((body as any).references?.length && body.getAttribute("data-refflow-result-type") === currentType) {
        return true;
      }
      const item = getPanelItem(views, body);
      if (item?.isRegularItem() && !body.hasAttribute("aria-busy")) {
        void views.refreshReferences(body as any, true, false, false, item, undefined, false);
      }
      return true;
    };

    if (headerClickSection && !sidenavButton) {
      globalThis.setTimeout(() => {
        if (views.isDisposed() || signal.aborted || !section.isConnected) return;
        const col = section.querySelector("collapsible-section") as any;
        if (col && !col.open) return;
        const body = section.querySelector('[data-type="body"]') as HTMLElement | null;
        if (body && !(body as any).references?.length) triggerFetch(body);
      }, 0);
      return;
    }

    const body = section.querySelector('[data-type="body"]') as HTMLElement | null;
    if (body && triggerFetch(body)) return;

    const pendingItemID = resolvePendingItemID(views, section, doc);
    const marker = pendingItemID || "true";
    section.setAttribute("data-refflow-fetch-requested", marker);
    globalThis.setTimeout(() => {
      if (views.isDisposed() || signal.aborted || !section.isConnected) return;
      if (section.getAttribute("data-refflow-fetch-requested") !== marker) return;
      const deferredBody = section.querySelector('[data-type="body"]') as HTMLElement | null;
      if (!deferredBody) return;
      if (pendingItemID && deferredBody.getAttribute("data-refflow-item-id") !== pendingItemID) return;
      triggerFetch(deferredBody);
    }, 50);
  };

  doc.addEventListener("click", onActivate, { capture: true, signal });
  doc.addEventListener("command", onActivate, { capture: true, signal });
}
