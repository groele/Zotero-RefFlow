import { config } from "../../package.json";
import Requests from "./requests";
import Views from "./views";
import buildGraphData from "./GraphData";
import { getString } from "../utils/locale";
import { cleanupSync } from "../utils/lifecycle";
import BatchImporter from "./batchImporter";
import { buildConnectedPapersPipeline } from "./connectedPapersPipeline";
import { addGraphStyles } from "./graphStyles";
import { createGraphViewer } from "./graphViewer";
import { setGraphNodeState } from "./graphVisualState";
import { renderGraphCard } from "./graphCard";
import { buildGraphRelatedPanel } from "./graphPanel";

export default class ConnectedPapers {
  private doc: Document;
  private win: any;
  private requests!: Requests;
  private frame!: HTMLIFrameElement;
  private views!: Views;
  private graphContainer?: HTMLDivElement;
  private relatedContainer?: HTMLDivElement;
  private boxAfter!: XUL.Box;
  private itemIDs: number[] = [];
  private zoteroColor: boolean = true;
  private cleanup: Array<() => void> = [];
  private disposed = false;
  private graphController?: AbortController;
  private graphSelectedID = "";
  private graphEventCleanup?: () => void;
  private selectListener = () => {
    this.updateAddOrRemove();
    this.syncRelatedPane(this.graphVisible);
  };

  constructor(views: Views, win: Window = window) {
    this.doc = win.document;
    this.win = win;
    this.views = views;
  }

  public async init() {
    this.requests = new Requests();
    this.addStyle();
    this.registerButton();
    this.initOnSelect();
    this.doc.querySelectorAll("#graph").forEach((e) => e.remove());
    let waitCount = 0;
    while (!this.doc.querySelector("#item-tree-main-default") && !this.disposed && !this.win.closed) {
      await Zotero.Promise.delay(100);
      if (++waitCount > 50) break;
    }
    if (!this.disposed && !this.win.closed) this.initItemsPane();
  }

  public shutdown() {
    if (this.disposed) return;
    this.disposed = true;
    cleanupSync(() => BatchImporter.cancelImports(undefined, this));
    cleanupSync(() => this.graphController?.abort());
    cleanupSync(() => this.graphEventCleanup?.());
    cleanupSync(() => this.requests?.dispose());
    cleanupSync(() => (this.win.ZoteroPane?.itemsView as any)?.onSelect?.removeListener(this.selectListener));
    this.cleanup.forEach(cleanupSync);
    this.cleanup = [];
    cleanupSync(() => this.graphContainer?.remove());
    cleanupSync(() => this.boxAfter?.remove());
    cleanupSync(() => this.doc.getElementById(`${config.addonRef}-show-hide-graph-view`)?.remove());
    cleanupSync(() => this.doc.getElementById(`${config.addonRef}-graph-style`)?.remove());
  }

  private addStyle() {
    addGraphStyles(this.doc);
  }

  private initOnSelect() {
    (this.win.ZoteroPane.itemsView as any)?.onSelect?.addListener(this.selectListener);
  }

  private updateAddOrRemove() {
    const removeNode = this.relatedContainer?.querySelector("#remove-origin") as HTMLDivElement;
    const addNode = this.relatedContainer?.querySelector("#add-origin") as HTMLDivElement;
    const selected = this.win.ZoteroPane?.getSelectedItems?.()?.[0]?.id as number;
    if (this.itemIDs.indexOf(selected) >= 0) {
      if (removeNode) removeNode.style.display = "flex";
      if (addNode) addNode.style.display = "none";
    } else {
      if (removeNode) removeNode.style.display = "none";
      if (addNode) addNode.style.display = "flex";
    }
  }

  private registerButton() {
    this.doc.querySelectorAll(`#${config.addonRef}-show-hide-graph-view`).forEach((e) => e.remove());
    const toolbar = this.doc.getElementById("zotero-items-toolbar");
    if (!toolbar) return;
    const newNode = (this.doc as any).createXULElement("toolbarbutton") as XUL.ToolBarButton;
    newNode.setAttribute("id", `${config.addonRef}-show-hide-graph-view`);
    newNode.setAttribute("class", "zotero-tb-button");
    newNode.setAttribute("tooltiptext", getString("graph-toggle-tooltip") || (Zotero.locale?.startsWith("zh") ? "显示 / 隐藏文献关系图" : "Show / hide citation graph"));
    newNode.setAttribute("aria-label", newNode.getAttribute("tooltiptext")!);
    newNode.setAttribute("tabindex", "0");
    newNode.addEventListener("click", async () => {
      const node = this.graphContainer;
      if (!node) return;
      if (node.style.display === "none") {
        if (!this.frame.getAttribute("src")) this.frame.setAttribute("src", `chrome://${config.addonRef}/content/dist/index.html`);
        node.style.display = "";
        this.syncRelatedPane(true);
        Zotero.Prefs.set(`${config.addonRef}.graphView.enable`, true);
      } else {
        node.style.display = "none";
        this.syncRelatedPane(false);
        Zotero.Prefs.set(`${config.addonRef}.graphView.enable`, false);
      }
    });
    newNode.style.listStyleImage = `url(chrome://${config.addonRef}/content/icons/connectedpapers.png)`;
    toolbar.insertBefore(newNode, this.doc.getElementById("zotero-tb-search"));
  }

  public get graphVisible(): boolean {
    return Boolean(this.graphContainer && this.graphContainer.style.display !== "none");
  }

  /** Own only a native custom section's body, never Zotero's deck or icon rail. */
  public mountRelatedPane(body: HTMLElement) {
    if (this.boxAfter?.parentElement === body) return;
    this.boxAfter?.remove();
    const boxAfter = this.boxAfter = this.doc.createElement("div") as any;
    boxAfter.id = "connected-papers-relatedsplit-after";
    boxAfter.style.overflow = "hidden";
    boxAfter.style.backgroundColor = "var(--material-background, #ffffff)";
    body.append(boxAfter);
    boxAfter.style.height = (Zotero.Prefs.get(`${config.addonRef}.graphView.height`) as string) || "400px";
    (boxAfter.style as any)["padding-top"] = "0";
    this.buildRelatedPanel(boxAfter);
  }

  public unmountRelatedPane(body: HTMLElement) {
    if (this.boxAfter?.parentElement !== body) return;
    this.boxAfter.remove();
    this.relatedContainer = undefined;
  }

  private syncRelatedPane(visible: boolean) {
    const item = this.win.ZoteroPane?.getSelectedItems?.()?.[0];
    const enabled = visible && Boolean(item?.isRegularItem?.());
    const section = this.doc.querySelector('#zotero-item-details item-pane-custom-section[data-pane$="-refflow-graph"]') as HTMLElement | null;
    if (!section) return;
    section.hidden = !enabled;
    const body = section.querySelector('[data-type="body"]') as HTMLElement | null;
    if (enabled && body) this.mountRelatedPane(body);
  }

  public buildRelatedPanel(box: XUL.Box) {
    this.relatedContainer = buildGraphRelatedPanel(box, {
      doc: this.doc,
      win: this.win,
      views: this.views,
      frame: this.frame,
      getItemIDs: () => this.itemIDs,
      setItemIDs: (ids) => { this.itemIDs = ids; },
      getPaperID: (item) => this.getPaperID(item),
      addItem: (parent, info, color) => this.addItem(parent as HTMLDivElement, info, color),
      refresh: (items) => this.refresh(items),
      paper2Info: (paper) => this.paper2Info(paper),
      updateAddOrRemove: () => this.updateAddOrRemove(),
      invalidateGraph: () => this.invalidateGraph(),
      isDisposed: () => this.disposed,
    });
  }

  private setNodeState(arg: { state: "selected" | "hover"; paperID: string }) {
    setGraphNodeState(arg, {
      relatedContainer: this.relatedContainer,
      frame: this.frame,
      getSelectedID: () => this.graphSelectedID,
      setSelectedID: (id) => { this.graphSelectedID = id; },
      setZoteroColor: (color) => { this.zoteroColor = color; },
    });
  }

  public addItem(parent: HTMLDivElement, info: ItemInfo, color?: string): any {
    return renderGraphCard(parent, info, color, {
      views: this.views,
      win: this.win,
      doc: this.doc,
      getItemIDs: () => this.itemIDs,
      setItemIDs: (ids) => { this.itemIDs = ids; },
      updateAddOrRemove: () => this.updateAddOrRemove(),
      setNodeState: (arg) => this.setNodeState(arg),
      isDisposed: () => this.disposed,
      getRelatedContainer: () => this.relatedContainer,
    });
  }

  private async getPaperID(item: Zotero.Item, signal?: AbortSignal) {
    const DOI = (item.getField("DOI") as string) || "";
    const title = (item.getField("title") as string) || "";
    const provider = this.views.utils.API.semanticScholar;
    try {
      const paper = DOI
        ? await provider.byDOI(DOI, signal)
        : await provider.byTitle(title, (item.getCreators()[0] as any)?.lastName, String(item.getField("date")), signal);
      return paper?.paperId;
    } catch (error) {
      if (!signal?.aborted) ztoolkit.log("Graph origin resolution failed", error);
    }
  }

  private async buildGraphData(items: Zotero.Item[], signal?: AbortSignal) {
    const indexingLabel = getString("graph-indexing") || "Indexing";
    const popupWin = new ztoolkit.ProgressWindow("Connected Papers", { closeOtherProgressWindows: true, closeTime: -1 })
      .createLine({ text: getString("graph-initializing") || "Initializing", type: "connectedpapers" })
      .show();
    const result = await buildConnectedPapersPipeline(items, {
      resolvePaperID: (item, requestSignal) => this.getPaperID(item, requestSignal),
      fetchGraph: (originKey, requestSignal) => buildGraphData(originKey, popupWin, 0, requestSignal),
      findLocalItem: (paper, libraryID) => this.views.utils.searchLibraryItem(this.paper2Info(paper), libraryID),
      onProgress: (complete, total) => popupWin.changeLine({ text: `[${complete}/${total}] ${indexingLabel}`, progress: total ? 100 * complete / total : 0 }),
    }, signal);
    if (result.status === "cancelled" || signal?.aborted) { popupWin.close(); return; }
    if (result.status === "origins-unavailable") {
      popupWin.changeLine({ text: getString("graph-origin-resolution-failed"), type: "fail" });
      popupWin.startCloseTimer(4000);
      return;
    }
    if (result.status === "graph-unavailable") { popupWin.startCloseTimer(4000); return; }
    const graphData = result.graph;
    if (!graphData) { popupWin.startCloseTimer(4000); return; }
    ztoolkit.log(graphData);
    popupWin.changeLine({ text: `[${Object.keys(graphData.nodes).length}/${Object.keys(graphData.nodes).length}] ${indexingLabel}`, type: "success" });
    popupWin.startCloseTimer(3000);
    return { graphData, partialOrigins: result.origins.unresolvedItemIDs.length, source: result.source };
  }

  private initItemsPane() {
    const viewer = createGraphViewer(this.doc, () => this.boxAfter as any);
    if (!viewer) return;
    this.graphContainer = viewer.graphContainer;
    this.frame = viewer.frame;
    this.cleanup.push(viewer.cleanup);
  }

  private paper2Info(paper: any): ItemInfo {
    return {
      identifiers: { DOI: paper.doi, paperID: paper.paperId },
      title: paper.title,
      year: paper.year,
      authors: paper.authors?.map((i: any) => i.name) || [],
      abstract: paper.abstract,
      primaryVenue: paper.venue,
      source: "Connected Papers",
      tags: paper.fieldsOfStudy,
      type: "",
      _itemID: paper._itemID
    };
  }

  private async refresh(items: Zotero.Item[]): Promise<{ graphData: Graph; partialOrigins: number; source: string } | undefined> {
    if (this.disposed || !items.length || items.some((item) => !item || item.deleted || !item.isRegularItem())) return;
    this.graphController?.abort();
    const controller = this.graphController = new this.win.AbortController() as AbortController;
    const origins = this.itemIDs.join(",");
    const current = () => !this.disposed && !controller.signal.aborted && this.graphController === controller && this.itemIDs.join(",") === origins;
    ztoolkit.log("refresh", items);
    const result = await this.buildGraphData(items, controller.signal) as { graphData: Graph; partialOrigins: number; source: string } | undefined;
    if (!result?.graphData?.nodes || !current()) return;
    const graphData = result.graphData;
    const readyDeadline = Date.now() + 10000;
    while (!(this.frame.contentWindow as any)?.RefFlowGraph && Date.now() < readyDeadline && current()) await Zotero.Promise.delay(100);
    if (!current()) return;
    const frameWindow = this.frame.contentWindow as any, bridge = frameWindow?.RefFlowGraph;
    if (bridge?.version !== 1) throw new Error("Graph view did not load the supported rendering interface");
    const partialOrigins = result.partialOrigins;
    bridge.setGraph(graphData, { origins: this.itemIDs.map(String), retrievedAt: new Date().toISOString(), partialOrigins, source: result.source });
    this.graphEventCleanup?.();
    const onGraphEvent = (event: any) => {
      const detail = event.detail;
      if (!current() || detail?.version !== 1 || !["select", "hover"].includes(detail.type)) return;
      if (detail.paperId && !Object.values(graphData.nodes).some((paper: any) => paper.paperId === detail.paperId)) return;
      this.setNodeState({ state: detail.type === "select" ? "selected" : "hover", paperID: detail.paperId });
      const target = this.relatedContainer?.querySelector(`.normal-items .${detail.type === "select" ? "selected" : "hover"}`) as HTMLElement;
      target?.scrollIntoView({ block: "nearest" });
    };
    frameWindow.addEventListener("refflow-graph-event", onGraphEvent);
    this.graphEventCleanup = () => frameWindow.removeEventListener("refflow-graph-event", onGraphEvent);
    return { graphData, partialOrigins, source: result.source };
  }

  private invalidateGraph() {
    this.graphController?.abort();
    this.graphEventCleanup?.();
    this.graphEventCleanup = undefined;
    this.graphSelectedID = "";
    (this.frame?.contentWindow as any)?.RefFlowGraph?.clear(getString("graph-origins-changed"));
    this.relatedContainer?.querySelectorAll(".normal-items .item,.prior-items .item,.deriv-items .item").forEach((node) => node.remove());
  }
}
