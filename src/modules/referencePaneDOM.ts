import { config } from "../../package.json";
import { getString } from "../utils/locale";
import ReferenceCards from "./referenceCards";
import BatchImporter from "./batchImporter";
import Views from "./views";
import { addReferencePaneStyles } from "./referencePaneStyles";

/**
 * Synchronizes the visibility of the cancel button depending on active fetch or import tasks.
 */
export function syncCancelButton(views: Views, body: Element): void {
  const cancel = body.querySelector<HTMLElement>("#refflow-cancel");
  if (!cancel) return;
  const itemID = Number(body.getAttribute("data-refflow-item-id"));
  cancel.hidden = !body.hasAttribute("aria-busy") && !(views.getPendingImports().get(body)?.get(itemID));
}

/**
 * Resets the contents and state of a reference sidebar pane.
 */
export function resetReferencePane(views: Views, body: Element): void {
  views.referenceTasks.invalidate(body);
  (body as any).references = [];
  (body as any)._cards?.clear();
  (body as any)._setL10nArgs?.(JSON.stringify({ count: 0 }));
  body.querySelector("#related-grid")?.replaceChildren();
  const sourceDetails = body.querySelector("#refflow-source-details") as HTMLDetailsElement | undefined;
  if (sourceDetails) {
    const controls = sourceDetails.querySelector(".refflow-status, #refflow-controls, .header");
    const summary = sourceDetails.querySelector("summary");
    for (const child of Array.from(sourceDetails.children)) {
      if (child !== summary && child !== controls) child.remove();
    }
    sourceDetails.hidden = true;
    sourceDetails.open = false;
  }
  body.removeAttribute("aria-busy");
  const count = body.querySelector("#reference-num");
  if (count) count.textContent = `0 ${getString("relatedbox-number-label")}`;
  body.querySelectorAll("button").forEach((button) => { (button as HTMLButtonElement).disabled = false; });
  const cancel = body.querySelector("#refflow-cancel") as HTMLElement;
  if (cancel) syncCancelButton(views, body);
}

/**
 * Cancels active imports and background fetch tasks for a reference sidebar pane.
 */
export function cancelReferencePane(views: Views, body: Element): void {
  BatchImporter.cancelImports(Number(body.getAttribute("data-refflow-item-id")), body);
  views.referenceTasks.invalidate(body);
  body.removeAttribute("aria-busy");
  body.querySelectorAll("#refresh-button, #refflow-force-refresh").forEach((button) => ((button as HTMLButtonElement).disabled = false));
  const cancel = body.querySelector("#refflow-cancel") as HTMLElement;
  if (cancel) cancel.hidden = true;
}

/**
 * Opens the reference type selection popup menu.
 */
export function showTypeMenu(views: Views, body: HTMLElement, item?: Zotero.Item): void {
  if (views.isDisposed()) return;
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
      if (views.isDisposed() || !body.isConnected || body.getAttribute("data-refflow-item-id") !== ownerID) return;
      resetReferencePane(views, body);
      body.setAttribute("data-refflow-type", type);
      Zotero.Prefs.set(`${config.addonRef}.type`, type);
      body.setAttribute("source", type === "References" ? String(Zotero.Prefs.get(`${config.addonRef}.prioritySource`) || "PDF") : "API");
      await views.refreshReferences(body as any, true, false, false, item?.parentItem || item);
    }).catch((error) => ztoolkit.log(error)));
    popup.append(entry);
  }
  views.getMenus().add(popup);
  popup.addEventListener("popuphidden", () => {
    views.getMenus().delete(popup);
    popup.remove();
  }, { once: true });
  doc.documentElement.append(popup);
  popup.openPopup(body.closest("item-pane-custom-section"), "after_end", 0, 0, false, false);
}

/**
 * Registers the native Zotero 10 reference item pane section.
 */
export function registerReferenceItemPane(views: Views): string | undefined {
  const paneManager = Zotero.ItemPaneManager;
  if (!paneManager?.registerSection) {
    ztoolkit.log("Zotero 10 ItemPaneManager is unavailable; reference sidebar section was not registered");
    return undefined;
  }

  const icon = `chrome://${config.addonRef}/content/icons/reference-sidenav.svg`;
  const paneID = `${config.addonRef}-references`;
  const registered = paneManager.registerSection({
    paneID,
    pluginID: config.addonID,
    sidenav: { l10nID: "refflow-pane-sidenav", icon },
    header: { l10nID: "refflow-pane-title", l10nArgs: JSON.stringify({ count: 0 }), icon: `chrome://${config.addonRef}/content/icons/reference.svg` },
    sectionButtons: [
      { type: "type", icon: `chrome://${config.addonRef}/content/icons/type.svg`, l10nID: "refflow-pane-type", onClick: ({ body, item }) => showTypeMenu(views, body, item) },
      { type: "refresh", icon: `chrome://${config.addonRef}/content/icons/refresh.svg`, l10nID: "refflow-pane-refresh", onClick: ({ body, item }) => views.refreshReferences(body as any, false, false, false, item?.parentItem || item) },
      { type: "more", icon: `chrome://${config.addonRef}/content/icons/more.svg`, l10nID: "refflow-pane-more", onClick: ({ body }) => (body as any)._cards?.menu() }
    ],
    onRender: ({ body, item, setL10nArgs }) => {
      views.getPanes().add(body as HTMLElement);
      views.attachDocument(body.ownerDocument);
      if (!body.ownerDocument.getElementById(`${config.addonRef}-style`)) addReferencePaneStyles(body.ownerDocument);
      const identity = String(item?.parentItem?.id || item?.id || "");
      if ((body as any)._cards && body.getAttribute("data-refflow-item-id") === identity && body.querySelector(".refflow-card-search")) {
        (body as any)._setL10nArgs = setL10nArgs;
        setL10nArgs(JSON.stringify({ count: (body as any).references?.length || 0 }));
        return;
      }
      views.referenceTasks.invalidate(body);
      body.replaceChildren();
      (body as any).references = [];
      body.setAttribute("data-refflow-type", String(Zotero.Prefs.get(`${config.addonRef}.type`) || "References"));
      body.classList.add("zotero-editpane-related");
      body.setAttribute("data-refflow-item-id", String(item?.parentItem?.id || item?.id || ""));
      body.setAttribute("source", (Zotero.Prefs.get(`${config.addonRef}.prioritySource`) as string) || "PDF");

      const controls = body.ownerDocument.createElement("div");
      controls.className = "header";
      const count = body.ownerDocument.createElement("label");
      count.id = "reference-num";
      count.setAttribute("role", "status");
      count.setAttribute("aria-live", "polite");
      count.textContent = `0 ${getString("relatedbox-number-label")}`;
      count.title = getString("relatedbox-copy-all-tooltip") || "Double-click to copy the reference list";
      count.addEventListener("dblclick", () => views.utils.copyText(((body as any).references || []).map((ref: ItemBaseInfo) => ref.text || ref.title || "").join("\n"), false));
      const source = body.ownerDocument.createElement("select");
      source.setAttribute("aria-label", getString("relatedbox-source-label") || "Reference source");
      for (const [value, label] of [["Auto", getString("cards-source-auto")], ["PDF", "PDF"], ["Web", getString("cards-source-web")], ["API", "Online"]]) {
        const option = body.ownerDocument.createElement("option");
        option.value = value;
        option.textContent = label;
        source.append(option);
      }
      source.value = body.getAttribute("source") || "PDF";
      source.addEventListener("change", () => {
        resetReferencePane(views, body);
        body.setAttribute("data-refflow-type", "References");
        Zotero.Prefs.set(`${config.addonRef}.type`, "References");
        body.setAttribute("source", source.value);
        Zotero.Prefs.set(`${config.addonRef}.prioritySource`, source.value);
        void views.refreshReferences(body as any, true);
      });

      const refresh = body.ownerDocument.createElement("button");
      refresh.type = "button";
      refresh.id = "refresh-button";
      refresh.textContent = getString("relatedbox-fetch-label") || "Get references";
      refresh.addEventListener("click", async () => {
        const currentItem = Zotero.Items.get(Number(body.getAttribute("data-refflow-item-id"))) as Zotero.Item | undefined;
        if (!currentItem || !currentItem.isRegularItem()) {
          count.textContent = getString("relatedbox-select-item") || "Select a reference item first";
          return;
        }
        try {
          await views.refreshReferences(body as any, true, false, false, currentItem);
        } catch (error) {
          ztoolkit.log("Item pane reference fetch failed:", error);
          count.textContent = getString("relatedbox-fetch-error") || "Fetch failed. Please try again.";
        } finally { if (!body.hasAttribute("aria-busy")) refresh.disabled = false; }
      });
      const force = body.ownerDocument.createElement("button");
      force.type = "button";
      force.id = "refflow-force-refresh";
      force.textContent = getString("relatedbox-force-label");
      force.addEventListener("click", () => views.refreshReferences(body as any, false).catch((error) => ztoolkit.log(error)));
      const cancel = body.ownerDocument.createElement("button");
      cancel.type = "button";
      cancel.id = "refflow-cancel";
      cancel.hidden = true;
      cancel.textContent = getString("relatedbox-cancel-label");
      cancel.addEventListener("click", () => {
        cancelReferencePane(views, body);
        count.textContent = getString("relatedbox-cancelled") + ((body as any).references?.length ? ` · ${getString("cards-kept-results")}` : "");
      });
      controls.style.flexWrap = "wrap";
      controls.style.gap = "6px";
      controls.classList.add("refflow-status");
      controls.id = "refflow-controls";
      source.hidden = true;
      refresh.hidden = true;
      force.hidden = true;
      controls.append(count, source, refresh, force, cancel);

      const sourceDetails = body.ownerDocument.createElement("details");
      sourceDetails.id = "refflow-source-details";
      sourceDetails.className = "refflow-source-details";
      sourceDetails.hidden = true;
      const summary = body.ownerDocument.createElement("summary");
      summary.textContent = getString("cards-source-details");
      sourceDetails.append(summary, controls);
      const search = body.ownerDocument.createElement("input");
      search.type = "search";
      search.className = "refflow-card-search";
      search.placeholder = getString("relatedbox-search-placeholder");
      search.setAttribute("aria-label", search.placeholder);

      const grid = body.ownerDocument.createElement("div");
      grid.id = "related-grid";
      grid.className = "grid";
      grid.style.overflowY = "auto";
      grid.style.display = "flex";
      grid.style.flexDirection = "column";
      body.append(search, sourceDetails, grid);
      (body as any)._cards?.dispose();
      (body as any)._cards = new ReferenceCards(views, body, grid, search, getString("cards-list-name"));
      (body as any)._setL10nArgs = setL10nArgs;
      setL10nArgs(JSON.stringify({ count: 0 }));
    },
    onAsyncRender: async ({ body, item }) => {
      const parent = item?.parentItem || item;
      if (!parent?.isRegularItem()) return;
      const excluded = String(Zotero.Prefs.get(`${config.addonRef}.notAutoRefreshItemTypes`) || "").split(",").map((value) => value.trim());
      if (Zotero.Prefs.get(`${config.addonRef}.autoRefresh`) && !excluded.includes(Zotero.ItemTypes.getName(parent.itemTypeID))) {
        await views.refreshReferences(body as any, true, false, false, parent);
      }
    },
    onItemChange: ({ body, item }) => {
      const identity = String(item?.parentItem?.id || item?.id || "");
      if (body.getAttribute("data-refflow-item-id") === identity) return;
      resetReferencePane(views, body);
      body.setAttribute("data-refflow-item-id", String(item?.parentItem?.id || item?.id || ""));
      syncCancelButton(views, body);
    },
    onDestroy: ({ body }) => {
      BatchImporter.cancelImports(undefined, body);
      views.getPanes().delete(body as HTMLElement);
      views.referenceTasks.invalidate(body);
      (body as any)._cards?.dispose();
    }
  });

  if (!registered) {
    ztoolkit.log("Zotero refused to register the RefFlow item-pane section");
    return undefined;
  }
  return registered;
}
