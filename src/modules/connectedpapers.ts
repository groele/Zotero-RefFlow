import Requests from "./requests";
import { config } from "../../package.json";

import Views from "./views";
import TipUI from "./tip";
import buildGraphData from "./GraphData";
import {graphColor} from "./graphModel";
import { cleanupSync } from "../utils/lifecycle";
import {getString} from '../utils/locale';
import {importFailureText,importErrorText} from './importErrors';
import BatchImporter from './batchImporter';
import { RelatedPanelBuilder } from "./graph/relatedPanelBuilder";
import { RelatedItemRenderer } from "./graph/relatedItemRenderer";

export default class ConnectedPapers {
  private doc: Document;
  private win: any;
  private requests!: Requests;
  private frame!: HTMLIFrameElement;
  private views!: Views
  private graphContainer?: HTMLDivElement;
  private relatedContainer?: HTMLDivElement
  // private splitterAfter!: HTMLElement;
  private boxAfter!: XUL.Box;
  private itemIDs: number[] = []
  private zoteroColor: boolean = true
  private cleanup: Array<()=>void> = [];
  private disposed = false;
  private graphController?: AbortController;
  private graphSelectedID="";
  private graphEventCleanup?:()=>void;
  private selectListener=()=>{this.updateAddOrRemove();this.syncRelatedPane(this.graphVisible);};
  constructor(views: Views, win: Window = window) {
    this.win=win;this.doc=win.document;
    this.requests = new Requests()
    this.views = views
  }

  public async init() {
    this.addStyle()
    this.registerButton()
    this.initOnSelect()
    this.doc.querySelectorAll("#graph").forEach(e => e.remove());
    let waitCount = 0;
    while (!this.doc.querySelector("#item-tree-main-default") && !this.disposed && !this.win.closed) {
      await Zotero.Promise.delay(100)
      if (++waitCount > 50) break;
    }
    if (!this.disposed && !this.win.closed) this.initItemsPane()
  }

  public shutdown() {
    if (this.disposed) return;
    this.disposed = true;
    cleanupSync(() => BatchImporter.cancelImports(undefined,this));
    cleanupSync(() => this.graphController?.abort());
    cleanupSync(() => this.graphEventCleanup?.());
    cleanupSync(() => this.requests.dispose());
    cleanupSync(() => this.win.ZoteroPane?.itemsView?.onSelect?.removeListener(this.selectListener));
    this.cleanup.forEach(cleanupSync);this.cleanup=[];
    cleanupSync(() => this.graphContainer?.remove());
    cleanupSync(() => this.boxAfter?.remove());
    cleanupSync(() => this.doc.getElementById(`${config.addonRef}-show-hide-graph-view`)?.remove());
    cleanupSync(() => this.doc.getElementById(`${config.addonRef}-graph-style`)?.remove());
  }

  private addStyle() {
    const id = `${config.addonRef}-related-container`
    ztoolkit.UI.appendElement({
      tag: "style",
      id: `${config.addonRef}-graph-style`,
      namespace: "html",
      properties: {
        innerHTML: `
          #${id} * {
            transition: background-color .1s linear;
          }
          #${id} .button, #${id} .item, #${id} .filter-button {
            height: 2em;
            line-height: 2em;
            cursor: pointer;
          }
          #${id} .button:hover, #${id} .item.hover {
            background-color: #f5f5f5;
          }
          #${id} .item.selected {
            background-color: #ebebeb;
          }
          #${id} .filter-button {
            display: inline-block;
            width: 50%;
            border: 1px solid rgb(238, 238, 238);
            text-align: center;
            color: #005028;
          }
          #${id} .filter-button:hover {
            background-color: #d9e5ec;
          }
          #${id} .filter-button.activate {
            color: #fff;
            background-color: #045384;
          }
          #${id} .item.highlight {
            background-color: #d9f5f9;
          }
          #${id} .item.highlight.hover {
            background-color: #d0ecf0;
          }
        `// 这里添加后会让Mac的图标变形，所以遇Mac不添
        + (Zotero.isMac ? "" : `
        #${config.addonRef}-show-hide-graph-view .toolbarbutton-icon {
          width: 16px;
          height: 16px;
        }
        `) 
      },
      // #output-container div.streaming span:after,  
    }, this.doc.documentElement);
  }

  private initOnSelect() {
    (this.win.ZoteroPane.itemsView as any)?.onSelect?.addListener(this.selectListener)
  }

  private updateAddOrRemove() {
    const removeNode = this.relatedContainer?.querySelector("#remove-origin") as HTMLDivElement
    const addNode = this.relatedContainer?.querySelector("#add-origin") as HTMLDivElement
    if (this.itemIDs.indexOf(this.win.ZoteroPane.getSelectedItems()[0]?.id as number) >= 0) {
      if (removeNode) {
        removeNode.style.display = "flex"
      }
      if (addNode) {
        addNode.style.display = "none"
      }
    } else {
      if (removeNode) {
        removeNode.style.display = "none"
      }
      if (addNode) {
        addNode.style.display = "flex"
      }
    }
  }

  private registerButton() {
    this.doc.querySelectorAll(`#${config.addonRef}-show-hide-graph-view`).forEach(e => e.remove());
    const toolbar = this.doc.getElementById("zotero-items-toolbar");
    if (!toolbar) return;
    const newNode = (this.doc as any).createXULElement("toolbarbutton") as XUL.ToolBarButton;
    newNode.setAttribute("id", `${config.addonRef}-show-hide-graph-view`);
    newNode.setAttribute("class", "zotero-tb-button");
    newNode.setAttribute("tooltiptext", getString("graph-toggle-tooltip") || (Zotero.locale?.startsWith("zh") ? "显示 / 隐藏文献关系图" : "Show / hide citation graph"));
    newNode.setAttribute("aria-label", newNode.getAttribute("tooltiptext")!);
    newNode.setAttribute("tabindex", "0");
    newNode.addEventListener("click", async () => {
      let node = this.graphContainer;
      if (!node) {return }
      if (node.style.display == "none") {
        if(!this.frame.getAttribute("src")) this.frame.setAttribute("src",`chrome://${config.addonRef}/content/dist/index.html`);
        // this.splitterAfter.style.display = ""
        node.style.display = ""
        this.syncRelatedPane(true)
        Zotero.Prefs.set(`${config.addonRef}.graphView.enable`, true)
      } else {
        // this.splitterAfter.style.display = "none"
        node.style.display = "none"
        this.syncRelatedPane(false)
        Zotero.Prefs.set(`${config.addonRef}.graphView.enable`, false)
      }
    })
    newNode.style.listStyleImage = `url(chrome://${config.addonRef}/content/icons/connectedpapers.png)`
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
    boxAfter.style.overflow = "hidden"
    boxAfter.style.backgroundColor = "var(--material-background, #ffffff)"
    body.append(boxAfter);
    boxAfter.style.height = (Zotero.Prefs.get(`${config.addonRef}.graphView.height`) as string) || "400px";
    // @ts-ignore
    boxAfter.style["padding-top"] = "0"
    this.buildRelatedPanel(boxAfter)
  }

  public unmountRelatedPane(body: HTMLElement) {
    if (this.boxAfter?.parentElement !== body) return;
    this.boxAfter.remove();
    this.relatedContainer = undefined;
  }

  private syncRelatedPane(visible: boolean) {
    const item = this.win.ZoteroPane.getSelectedItems()[0];
    const enabled = visible && Boolean(item?.isRegularItem());
    const section = this.doc.querySelector('#zotero-item-details item-pane-custom-section[data-pane$="-refflow-graph"]') as HTMLElement | null;
    if (!section) return;
    section.hidden = !enabled;
    const body = section.querySelector('[data-type="body"]') as HTMLElement | null;
    if (enabled && body) this.mountRelatedPane(body);
  }

  public buildRelatedPanel(box: XUL.Box) {
    return RelatedPanelBuilder.build(this, box);
  }

  /**
   * 图谱节点和列表节点同时触发状态
   * @param arg 
   */
  private setNodeState(arg: {
    state: "selected" | "hover",
    paperID: string,
  }) {
    if (arg.state == "selected") {
      let selectedItemNode: HTMLDivElement | undefined = undefined;
      Array.prototype.forEach.call(
        this.relatedContainer?.querySelectorAll(".items-container .item"),
        (itemNode) => {
          if (itemNode._ref.identifiers.paperID == arg.paperID) {
            itemNode.classList.add("selected")
            selectedItemNode = itemNode
            
          } else {
            itemNode.classList.remove("selected")
          }
        },
      );
      let src = "Nodes";
      this.zoteroColor = true;
      if (selectedItemNode) {
        const parent = (selectedItemNode as HTMLDivElement).parentElement;
        if (parent?.classList.contains("prior-items")) {
          src = "Prior";
          this.zoteroColor = false;
        } else if (parent?.classList.contains("deriv-items")) {
          this.zoteroColor = false;
          src = "Deriv";
        }
      }
      // @ts-ignore
      this.graphSelectedID=arg.paperID;
      this.frame.contentWindow?.RefFlowGraph?.setState({selected:arg.paperID});
      // 选择普通item，设置prior/deriv works背景色
      [
        ...this.relatedContainer?.querySelectorAll(".prior-items .item") as any, 
        ...this.relatedContainer?.querySelectorAll(".deriv-items .item") as any
      ].forEach(itemNode => {
        if (itemNode.getAttribute("local")?.indexOf(arg.paperID) >= 0) {
          itemNode.classList.add("highlight");
        } else {
          itemNode.classList.remove("highlight");
        }
      });
      // 选择prior/deriv works，普通item背景色
      if (selectedItemNode) {
        const local = (selectedItemNode as HTMLDivElement).getAttribute("local");
        Array.prototype.forEach.call(
          this.relatedContainer?.querySelectorAll(".normal-items .item"),
          (itemNode) => {
            if (local && local.indexOf(itemNode._ref.identifiers.paperID) >= 0) {
              itemNode.classList.add("highlight");
            } else {
              itemNode.classList.remove("highlight");
            }
          },
        );
      }

    } else if (arg.state == "hover") {
      // @ts-ignore
      this.frame.contentWindow?.RefFlowGraph?.setState({hover:arg.paperID});
      Array.prototype.forEach.call(
        this.relatedContainer?.querySelectorAll(".item"),
        (itemNode) => {
          // 跳过选择
          // @ts-ignore
          if (this.graphSelectedID == itemNode._ref.identifiers.paperID) {
            return
          }
          if (itemNode._ref.identifiers.paperID == arg.paperID) {
            itemNode.classList.add("hover")
          } else {
            itemNode.classList.remove("hover")

          }
        }
      )
    }
  }

  public addItem(parent: HTMLDivElement, info: ItemInfo, color?: string): any {
    return RelatedItemRenderer.render(this, parent, info, color);
  }


  private async getPaperID(item: Zotero.Item, signal?: AbortSignal) {
    const DOI = (item.getField("DOI") as string) || "";
    const title = (item.getField("title") as string) || "";
    const provider=this.views.utils.API.semanticScholar;
    try {
      const paper=DOI?await provider.byDOI(DOI,signal):await provider.byTitle(title,(item.getCreators()[0] as any)?.lastName,String(item.getField("date")),signal);
      return paper?.paperId;
    }catch(error){if(!signal?.aborted)ztoolkit.log("Graph origin resolution failed",error);}
  }

  private async buildGraphData(items: Zotero.Item[], signal?: AbortSignal) {
    const popupWin = new ztoolkit.ProgressWindow("Connected Papers", { closeOtherProgressWindows: true, closeTime: -1 })
      .createLine({ text: "Initializing", type: "connectedpapers" })
      .show()
    let id = (await Promise.all(items.map(async (item) => await this.getPaperID(item, signal)))).join("+")
    if (signal?.aborted) { popupWin.close(); return; }
    const graphData = await buildGraphData(id, popupWin, 0, signal)
    if (!graphData) { return }
    const totalNum = Object.keys(graphData.nodes).length
    popupWin.changeLine({ text: `[1/${totalNum}] Indexing`, progress: 1, type: "default" })
    const libraries = [...new Set(items.map(item => item.libraryID))];
    let i = 0
    for (let paperID in graphData.nodes) {
      i += 1
      let localItem
      try {
        if (signal?.aborted) { popupWin.close(); return; }
        for (const libraryID of libraries) {
          localItem = await this.views.utils.searchLibraryItem(this.paper2Info(graphData.nodes[paperID]), libraryID);
          if (localItem) break;
        }
      } catch { }
      popupWin.changeLine({ text: `[${i}/${totalNum}] Indexing`, progress: 100 * i / totalNum });
      (graphData.nodes[paperID] as any)._itemID = localItem?.id
    }
    ztoolkit.log(graphData)
    popupWin.changeLine({ text: `[${totalNum}/${totalNum}] Indexing`, type: "success" })
    popupWin.startCloseTimer(3000)
    return graphData
  }

  private initItemsPane() {
    const mainNode = this.doc.querySelector("#item-tree-main-default")!
    if(!mainNode) return;
    // 图形容器
    const minHeight = 200
    const graphContainer = ztoolkit.UI.createElement(this.doc, "div", {
      id: "graph-view",
      styles: {
        width: "100%",
        minHeight: `${minHeight}px`,
        height: (Zotero.Prefs.get(`${config.addonRef}.graphView.height`) as string) || "400px",
        display: "none",
      }
    })
    this.graphContainer = graphContainer
    const frame = this.frame = ztoolkit.UI.createElement(this.doc, "iframe", {namespace: "html"}) as HTMLIFrameElement
    // The graph application is expensive; load it on the first visible request.
    frame.style.border = "none"
    frame.style.outline = "none"
    frame.style.width = "100%"
    frame.style.height = graphContainer.style.height;
    frame.style.overflow = "hidden"
    frame.style.backgroundColor = "transparent"
    graphContainer.append(frame)
    mainNode.append(graphContainer)
    const resizer = ztoolkit.UI.createElement(this.doc, "div", {
      styles: {
        height: `1px`,
        width: "100%",
        backgroundColor: "#cecece",
        cursor: "ns-resize",
      },
    })
    graphContainer.insertBefore(resizer, frame)
    let y = 0, x = 0;
    let h = 0, w = 0;
    const mouseDownHandler = (e: MouseEvent) => {
      frame.style.display = "none"
      y = e.clientY;
      x = e.clientX;
      const rect = graphContainer.getBoundingClientRect()
      h = rect.height;
      w = rect.width;
      this.doc.addEventListener('mousemove', mouseMoveHandler);
      this.doc.addEventListener('mouseup', mouseUpHandler);
    };
    const mouseMoveHandler = (e: MouseEvent) => {
      const dy = e.clientY - y;
      let hh = h - dy
      const height = `${hh <= minHeight ? minHeight : hh}px`
      graphContainer.style.height = height;
      frame.style.height = height;
      if (this.boxAfter) this.boxAfter.style.height = height;
      Zotero.Prefs.set(`${config.addonRef}.graphView.height`, height)
    };
    const mouseUpHandler = () => {
      frame.style.display = ""
      this.doc.removeEventListener('mousemove', mouseMoveHandler);
      this.doc.removeEventListener('mouseup', mouseUpHandler);
    };
    resizer.addEventListener('mousedown', mouseDownHandler);
    this.cleanup.push(()=>{resizer.removeEventListener('mousedown',mouseDownHandler);this.doc.removeEventListener('mousemove',mouseMoveHandler);this.doc.removeEventListener('mouseup',mouseUpHandler);});
  }

  private paper2Info(paper: any) {
    return {
      identifiers: { DOI: paper.doi, paperID: paper.paperId },
      title: paper.title,
      year: paper.year,
      authors: paper.authors?.map((i: any) => i.name) || [],
      abstract: paper.abstract,
      primaryVenue: paper.venue,
      source: "connected papers",
      tags: paper.fieldsOfStudy,
      type: "",
      _itemID: paper._itemID
    }
  }

  private async refresh(items: Zotero.Item[]) {
    if (this.disposed || !items.length || items.some(item => !item || item.deleted || !item.isRegularItem())) return;
    this.graphController?.abort();
    const controller = this.graphController = new this.win.AbortController() as AbortController;
    const origins = this.itemIDs.join(",");
    const current = () => !this.disposed && !controller.signal.aborted && this.graphController === controller && this.itemIDs.join(",") === origins;
    ztoolkit.log("refresh", items)
    const graphData = await this.buildGraphData(items, controller.signal) as Graph
    if(!graphData?.nodes || !current()) return;
    const readyDeadline=Date.now()+10000;
    while(!(this.frame.contentWindow as any)?.RefFlowGraph && Date.now()<readyDeadline && current())await Zotero.Promise.delay(100);
    if(!current())return;
    const frameWindow=this.frame.contentWindow as any,bridge=frameWindow?.RefFlowGraph;
    if(bridge?.version!==1)throw new Error('Graph view did not load the supported rendering interface');
    bridge.setGraph(graphData,{origins:this.itemIDs.map(String),retrievedAt:new Date().toISOString()});
    this.graphEventCleanup?.();
    const onGraphEvent=(event:any)=>{
      const detail=event.detail;if(!current()||detail?.version!==1||!['select','hover'].includes(detail.type))return;
      if(detail.paperId&&!Object.values(graphData.nodes).some((paper:any)=>paper.paperId===detail.paperId))return;
      this.setNodeState({state:detail.type==='select'?'selected':'hover',paperID:detail.paperId});
      const target=this.relatedContainer?.querySelector(`.normal-items .${detail.type==='select'?'selected':'hover'}`) as HTMLElement;
      target?.scrollIntoView({block:'nearest'});
    };
    frameWindow.addEventListener('refflow-graph-event',onGraphEvent);
    this.graphEventCleanup=()=>frameWindow.removeEventListener('refflow-graph-event',onGraphEvent);
    return graphData;
  }

  private invalidateGraph(){
    this.graphController?.abort();this.graphEventCleanup?.();this.graphEventCleanup=undefined;this.graphSelectedID='';
    (this.frame?.contentWindow as any)?.RefFlowGraph?.clear(getString('graph-origins-changed'));
    this.relatedContainer?.querySelectorAll('.normal-items .item,.prior-items .item,.deriv-items .item').forEach(node=>node.remove());
  }
}
