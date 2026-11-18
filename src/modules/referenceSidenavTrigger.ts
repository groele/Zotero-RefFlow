import { config } from "../../package.json";
import type Views from "./views";
import { getPanelItem } from "./referencePipeline";

const paneID = `${config.addonRef}-references`;
const sectionSelector = `item-pane-custom-section[data-pane$="-${paneID}"]`;
const fetchRequest = "data-refflow-fetch-requested";
const itemIDAttribute = "data-refflow-item-id";

interface NativeCollapsibleSection extends HTMLElement {
  open: boolean;
}

interface NativeItemPaneSection extends Element {
  item?: Zotero.Item;
}

interface NativeSidenav extends Element {
  container?: { getEnabledPane(id: string): NativeItemPaneSection | null };
}

export function shouldLoadReferenceCache(item: Zotero.Item): boolean {
  if (!Zotero.Prefs.get(`${config.addonRef}.autoRefresh`)) return false;
  const excluded = String(Zotero.Prefs.get(`${config.addonRef}.notAutoRefreshItemTypes`) || "")
    .split(",")
    .map((value) => value.trim());
  return !excluded.includes(Zotero.ItemTypes.getName(item.itemTypeID));
}

export async function fetchUnloadedReferences(views: Views, body: HTMLDivElement, item?: Zotero.Item): Promise<void> {
  const panel = body as unknown as XUL.TabPanel & { references?: ItemBaseInfo[] };
  if (views.isDisposed() || !body.isConnected || body.hasAttribute("aria-busy")) return;
  const type = body.getAttribute("data-refflow-type") || "References";
  if (panel.references?.length && body.getAttribute("data-refflow-result-type") === type) return;
  if (item?.isRegularItem()) await views.refreshReferences(panel, true, false, false, item);
}

/** Observe user actions while letting Zotero handle the header's native toggle. */
export function bindReferenceSidenavClick(views: Views, doc: Document, signal: AbortSignal): void {
  const onActivate = (event: Event) => {
    if (views.isDisposed()) return;
    const target = event.target as Element | null;
    if (!target?.closest) return;
    const isClick = event.type === "click";
    if (isClick && (event as MouseEvent).button !== 0) return;

    // Zotero also puts data-pane on collapsible-section. Only the rail button
    // identifies navigation, and its container identifies the active item pane.
    const railButton = isClick ? target.closest("item-pane-sidenav .btn[data-pane]") : null;
    if (railButton) {
      const id = railButton.getAttribute("data-pane") || "";
      if (id !== paneID && !id.endsWith(`-${paneID}`)) return;
      if ((event as MouseEvent).detail > 1 || railButton.hasAttribute("disabled")) return;
      const rail = railButton.closest("item-pane-sidenav") as NativeSidenav | null;
      const section = rail?.container?.getEnabledPane(id);
      const collapsible = section?.querySelector<NativeCollapsibleSection>("collapsible-section");
      const body = collapsible?.querySelector<HTMLDivElement>('[data-type="body"]');
      if (!section || !collapsible || !body) return;
      collapsible.open = true;
      const item = section.item?.parentItem || section.item;
      if (!item?.isRegularItem()) return;
      if (body.getAttribute(itemIDAttribute) === String(item.id)) {
        void fetchUnloadedReferences(views, body, item);
      } else {
        section.setAttribute(fetchRequest, String(item.id));
      }
      return;
    }

    const head = target.closest(".head");
    const collapsible = head?.parentElement as NativeCollapsibleSection | undefined;
    const section = collapsible?.parentElement;
    if (!head || collapsible?.localName !== "collapsible-section" || !section?.matches(sectionSelector)) return;
    if (target.closest(".section-custom-button, menupopup")) return;
    if (!isClick && (target !== head || !["Enter", " ", "ArrowLeft", "ArrowRight"].includes((event as KeyboardEvent).key))) return;
    if (collapsible.open) return;
    const body = collapsible.querySelector<HTMLDivElement>('[data-type="body"]');
    const identity = body?.getAttribute(itemIDAttribute);
    if (!body || !identity) return;

    // The native handler runs later in event propagation, including keyboard
    // actions that Zotero translates into a click on the twisty.
    globalThis.setTimeout(() => {
      if (signal.aborted || views.isDisposed() || !collapsible.open || body.getAttribute(itemIDAttribute) !== identity) return;
      void fetchUnloadedReferences(views, body, getPanelItem(views, body));
    }, 0);
  };

  doc.addEventListener("click", onActivate, { capture: true, signal });
  doc.addEventListener("keydown", onActivate, { capture: true, signal });
}
