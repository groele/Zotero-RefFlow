import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { safeProviderAttempt } from "./referenceSourceDetails";
import { readerMatchesItem } from "./referenceAttachment";
import { syncCancelButton } from "./referencePaneDOM";
import { getPanelItem } from "./referencePipeline";
import Views from "./views";

/**
 * Coordinates and dispatches a reference refresh task across UI panels with debounce and cancellation guards.
 */
export async function dispatchReferenceRefresh(
  views: Views,
  panel: XUL.TabPanel,
  local: boolean = true,
  fromCurrentPage: boolean = false,
  toggleSource: boolean = false,
  itemOverride?: Zotero.Item,
  readerOverride?: _ZoteroTypes.ReaderInstance
) {
  if (views.isDisposed() || !panel?.isConnected) return;
  if (toggleSource) panel.setAttribute("source", panel.getAttribute("source") === "PDF" ? "API" : "PDF");
  const literatureType = panel.getAttribute("data-refflow-type") || "References";
  const source = literatureType === "References" ? (panel.getAttribute("source") || (Zotero.Prefs.get(`${config.addonRef}.prioritySource`) as string) || "PDF") : "API";
  panel.setAttribute("source", source);
  const item = itemOverride || getPanelItem(views, panel);
  const label = panel.querySelector("#reference-num");
  if (!item?.isRegularItem()) {
    if (label) label.textContent = getString("relatedbox-select-item");
    return;
  }
  const ownerID = panel.getAttribute("data-refflow-item-id");
  if (ownerID && ownerID !== String(item.id)) return;
  const metadataIdentity = JSON.stringify([item.libraryID, item.key, item.getField("DOI"), item.getField("title"), item.getField("url"), item.getField("date"), item.getCreators()]);
  const activeReader = readerOverride || views.utils.getReader(panel.ownerDocument.defaultView!);
  const activeAttachment = readerMatchesItem(activeReader, item) ? Zotero.Items.get(activeReader!.itemID!) : undefined;
  const pageIndex = fromCurrentPage && activeAttachment ? activeAttachment.getAttachmentLastPageIndex() : undefined;
  const boundIdentity = panel.getAttribute("data-refflow-item-id");
  const windowReader = views.utils.getReader(panel.ownerDocument.defaultView!);
  const checkReader = literatureType === "References" && source !== "Web" && readerMatchesItem(windowReader, item);
  const sameInput = () => metadataIdentity === JSON.stringify([item.libraryID, item.key, item.getField("DOI"), item.getField("title"), item.getField("url"), item.getField("date"), item.getCreators()]) && (!checkReader || views.utils.getReader(panel.ownerDocument.defaultView!)?.itemID === activeReader?.itemID);
  const key = `${metadataIdentity}|${activeAttachment ? activeAttachment.id : "best"}|${literatureType}|${source}|${fromCurrentPage ? "page:" + (pageIndex ?? "stored") : "full"}|${local ? "cache" : "force"}`;

  return views.referenceTasks.run(panel, key, async (context) => {
    const boundItem = panel.getAttribute("data-refflow-item-id");
    const ownsPanel = () => context.isCurrent() && panel.isConnected && (panel.getAttribute("data-refflow-type") || "References") === literatureType && panel.getAttribute("source") === source && panel.getAttribute("data-refflow-item-id") === boundItem;
    const current = () => ownsPanel() && sameInput();
    panel.setAttribute("aria-busy", "true");
    panel.querySelectorAll("#refresh-button, #refflow-force-refresh").forEach((button) => ((button as HTMLButtonElement).disabled = true));
    const cancel = panel.querySelector("#refflow-cancel") as HTMLElement;
    if (cancel) cancel.hidden = false;
    try {
      await views.performReferences(panel, local, fromCurrentPage, item, activeReader, { ...context, pageIndex, isCurrent: current });
    } catch (error: any) {
      if (current() && label) {
        label.textContent = (error?.name === "TimeoutError" ? getString("relatedbox-timeout") : getString("relatedbox-fetch-error")) + ((panel as any).references?.length ? ` · ${getString("cards-kept-results")}` : "");
        (label as HTMLElement).title = safeProviderAttempt(String(error?.message || error));
      }
      if (error?.name !== "AbortError") ztoolkit.log("Reference fetch failed", safeProviderAttempt(String(error?.message || error)));
    } finally {
      if (ownsPanel()) {
        if (!sameInput() && label) label.textContent = getString("cards-context-changed") + ((panel as any).references?.length ? ` · ${getString("cards-kept-results")}` : "");
        panel.removeAttribute("aria-busy");
        panel.querySelectorAll("#refresh-button, #refflow-force-refresh").forEach((button) => ((button as HTMLButtonElement).disabled = false));
        if (cancel) syncCancelButton(views, panel);
      }
    }
  }, {
    onTimeout: () => {
      if (!panel.isConnected || panel.getAttribute("data-refflow-item-id") !== boundIdentity || panel.getAttribute("source") !== source || (panel.getAttribute("data-refflow-type") || "References") !== literatureType) return;
      if (label) label.textContent = getString(sameInput() ? "relatedbox-timeout" : "cards-context-changed") + ((panel as any).references?.length ? ` · ${getString("cards-kept-results")}` : "");
      panel.removeAttribute("aria-busy");
      panel.querySelectorAll("#refresh-button, #refflow-force-refresh").forEach((button) => ((button as HTMLButtonElement).disabled = false));
      const cancel = panel.querySelector("#refflow-cancel") as HTMLElement;
      if (cancel) syncCancelButton(views, panel);
    }
  });
}
