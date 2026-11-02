import { config } from "../../../package.json";
import { getString } from "../../utils/locale";
import ReferenceCards from "../referenceCards";
import BatchImporter from "../batchImporter";
import type Views from "../views";

export class PaneRenderer {
  public static resetReferencePane(views: Views, body: Element): void {
    views.referenceTasks.invalidate(body);
    (body as any).references = [];
    (body as any)._cards?.clear();
    views.updateSectionSummary(body, "");
    (body as any)._setL10nArgs?.(JSON.stringify({ count: 0 }));
    body.querySelector("#related-grid")?.replaceChildren();
    const sourceDetails = body.querySelector("#refflow-source-details") as HTMLDetailsElement | undefined;
    if (sourceDetails) {
      sourceDetails.replaceChildren();
      sourceDetails.hidden = true;
      sourceDetails.open = false;
    }
    body.removeAttribute("aria-busy");
    const count = body.querySelector("#reference-num");
    if (count) count.textContent = `0 ${getString("relatedbox-number-label")}`;
    body.querySelectorAll("button").forEach(button => { (button as HTMLButtonElement).disabled = false; });
    const cancel = body.querySelector("#refflow-cancel") as HTMLElement;
    if (cancel) (views as any).syncCancelButton(body);
  }

  public static cancelReferencePane(views: Views, body: Element): void {
    BatchImporter.cancelImports(Number(body.getAttribute("data-refflow-item-id")), body);
    views.referenceTasks.invalidate(body);
    views.updateSectionSummary(body, getString("relatedbox-cancelled") || "已取消获取");
    body.removeAttribute("aria-busy");
    body.querySelectorAll("#refresh-button, #refflow-force-refresh").forEach(button => (button as HTMLButtonElement).disabled = false);
    const cancel = body.querySelector("#refflow-cancel") as HTMLElement;
    if (cancel) cancel.hidden = true;
  }

  public static typeMenu(views: Views, body: HTMLElement, item?: Zotero.Item): void {
    if ((views as any).disposed) return;
    const doc: any = body.ownerDocument;
    const popup = doc.createXULElement("menupopup");
    const ownerID = body.getAttribute("data-refflow-item-id");
    popup.setAttribute("data-refflow-menu", "literature");

    for (const [type, key] of [["References", "cards-type-references"], ["Citations", "cards-type-citations"], ["Related", "cards-type-related"]]) {
      const entry = doc.createXULElement("menuitem");
      entry.setAttribute("label", getString(key));
      entry.setAttribute("type", "radio");
      entry.checked = body.getAttribute("data-refflow-type") === type;
      entry.addEventListener("command", () => Promise.resolve().then(async () => {
        if ((views as any).disposed || !body.isConnected || body.getAttribute("data-refflow-item-id") !== ownerID) return;
        PaneRenderer.resetReferencePane(views, body);
        body.setAttribute("data-refflow-type", type);
        Zotero.Prefs.set(`${config.addonRef}.type`, type);
        body.setAttribute("source", type === "References" ? String(Zotero.Prefs.get(`${config.addonRef}.prioritySource`) || "PDF") : "API");
        await views.refreshReferences(body as any, true, false, false, item?.parentItem || item);
      }).catch(error => ztoolkit.log(error)));
      popup.append(entry);
    }

    const menus = (views as any).menus as Set<Element>;
    menus.add(popup);
    popup.addEventListener("popuphidden", () => {
      menus.delete(popup);
      popup.remove();
    }, { once: true });
    doc.documentElement.append(popup);
    popup.openPopup(body.closest("item-pane-custom-section"), "after_end", 0, 0, false, false);
  }
}
