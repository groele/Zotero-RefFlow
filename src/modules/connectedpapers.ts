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
    newNode.setAttribute("tooltiptext", Zotero.locale.startsWith("zh") ? "显示 / 隐藏文献关系图" : "Show / hide citation graph");
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
    const relatedContainer = ztoolkit.UI.appendElement({
      // namespace: "xul",
      id: `${config.addonRef}-related-container`,
      tag: "div",
      styles: {
        margin: "0",
        padding: "0",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        height: "100%"
      },
      children: [
        // origin container
        {
          tag: "div", 
          id: "origin-items-container",
          styles: {
            display: "flex",
            flexDirection: "column"
          },
          children: [
            {
              tag: "div",
              styles: {
                maxHeight: "8em",
                overflow: "auto",
                borderTop: "1px solid #cecece",
                // borderBottom: "1px solid #cecece",
              },
              classList: ["origin-items"]
            },  
            // add origin
            {
              tag: "div",
              id: "add-origin",
              classList: ["button"],
              styles: {
                display: "flex",
                justifyContent: "center",
                alignContent: "center",
                cursor: "pointer",
                height: "2em",
              },
              children: [
                {
                  tag: "div",
                  classList: ["icon"],
                  properties: {
                    innerHTML: `<svg style="margin-right: .5em;" width="24" height="24"  viewBox="2 0 24 24" fill="#7a306c" xmlns="http://www.w3.org/2000/svg" class="graph-action-icon mr-[6px]" data-v-f4c185ee=""><path d="M11 19V13H5V11H11V5H13V11H19V13H13V19H11Z"></path></svg>`
                  }
                },
                {
                  tag: "span",
                  styles: {
                    lineHeight: "2em"
                  },
                  properties: {
                    innerText: "Add Origin",
                  }
                }
              ],
              listeners: [
                {
                  type: "click",
                  listener: async () => {
                    const items = this.win.ZoteroPane.getSelectedItems();
                    if (!items || items.length === 0 || !items[0]) {
                      return;
                    }
                    const item = items[0];
                    const itemTitle = (item.getField("title") as string) || "Item";
                    const popupWin = new ztoolkit.ProgressWindow("Add Origin", {closeTime: -1})
                      .createLine({ text: itemTitle, type: "connectedpapers" })
                      .show()
                    let info: ItemInfo = {
                      identifiers: { DOI: (item.getField("DOI") as string) || "", paperID: await this.getPaperID(item) },
                      authors: item.getCreators().map((i: any) => i.name || [i.firstName, i.lastName].filter(Boolean).join(" ")),
                      tags: item.getTags().map((i: any) => {
                        // @ts-ignore
                        let ctag: any = item.getColoredTags().find((ci: any) => ci.tag == i.tag)
                        if (ctag) {
                          return { text: i.tag, color: ctag.color }
                        } else {
                          return i.tag
                        }
                      }),
                      abstract: item.getField("abstractNote") as string,
                      title: itemTitle,
                      year: ((item.getField("date") as string) || "").match(/\b(19\d\d|20\d\d)\b/)?.[0] || undefined,
                      primaryVenue: item.getField("publicationTitle") as string,
                      type: "",
                      source: "Zotero",
                      _itemID: item.id
                    }
                    
                    this.addItem(
                      relatedContainer.querySelector("#origin-items-container .origin-items")!,
                      info,
                    )
                    if(this.disposed||!relatedContainer.isConnected||this.itemIDs.includes(item.id))return;
                    this.itemIDs.push(item.id)
                    this.invalidateGraph();
                    this.updateAddOrRemove()
                    popupWin.changeLine({ text: itemTitle, type: "success" })
                      .startCloseTimer(1000)
                  }
                }
              ]
            },
            // remove origin
            {
              tag: "div",
              id: "remove-origin",
              classList: ["button"],
              styles: {
                display: "none",
                justifyContent: "center",
                alignContent: "center",
                cursor: "pointer",
                height: "2em",
                backgroundColor: "#fff !important",
              },
              children: [
                {
                  tag: "div",
                  classList: ["icon"],
                  properties: {
                    innerHTML: `<svg style="margin-right: .5em;"  width="24" height="24" viewBox="0 0 24 24" fill="#7a306c" xmlns="http://www.w3.org/2000/svg" class="graph-action-icon mr-[6px]" data-v-f4c185ee=""><path d="M19 13H5V11H19V13Z"></path></svg>`
                  }
                },
                {
                  tag: "span",
                  styles: {
                    lineHeight: "2em"
                  },
                  properties: {
                    innerText: "Remove Origin",
                  }
                }
              ],
              listeners: [
                {
                  type: "click",
                  listener: () => {
                    const items = this.win.ZoteroPane.getSelectedItems();
                    if (!items || items.length === 0 || !items[0]) return;
                    const itemID = items[0].id;
                    this.itemIDs = this.itemIDs.filter(i => i != itemID)
                    this.invalidateGraph();
                    relatedContainer.querySelectorAll(".normal-items .item")?.forEach(e => e.remove())
                    relatedContainer.querySelectorAll("#origin-items-container .origin-items .item")
                      .forEach(e => {
                        if (Number(e.getAttribute("zotero-item-id")) == itemID) {
                          e.remove()
                        }
                      })
                    this.updateAddOrRemove()
                  }
                }
              ]
            }
          ]
        },
        // build graph
        {
          tag: "div",
          id: "build-graph",
          classList: ["button"],
          styles: {
            width: "100%",
            borderTop: "1px solid #eee",
            borderBottom: "1px solid #eee",
            display: "flex",
            flexDirection: "row",
            justifyContent: "center",
            alignContent: "center",
            cursor: "pointer",
            height: "2em"
          },
          children: [
            {
              tag: "div",
              styles: {
                display: "flex",
                justifyContent: "center",
                alignContent: "center",
              },
              properties: {
                innerHTML: `<svg style="margin: auto 0; margin-right: .5em;" width="20" height="20" viewBox="-8 -5.5 35 35" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M16.1757 14.0888L13.9333 7.08338L14.5478 6.93021L16.7901 13.9356L16.1757 14.0888Z" fill="url(#paint0_linear_icon)"></path><path fill-rule="evenodd" clip-rule="evenodd" d="M6.33333 15.1579L11.4 6.31579L11.9499 6.62914L6.88322 15.4712L6.33333 15.1579Z" fill="url(#paint1_linear_icon)"></path><path d="M19 13.8947C19 15.29 17.8658 16.4211 16.4667 16.4211C15.0675 16.4211 13.9333 15.29 13.9333 13.8947C13.9333 12.4995 15.0675 11.3684 16.4667 11.3684C17.8658 11.3684 19 12.4995 19 13.8947Z" fill="url(#paint2_linear_icon)"></path><path d="M10.1333 18.9474C10.1333 21.7379 7.86491 24 5.06667 24C2.26842 24 0 21.7379 0 18.9474C0 16.1569 2.26842 13.8947 5.06667 13.8947C7.86491 13.8947 10.1333 16.1569 10.1333 18.9474Z" fill="url(#paint3_linear_icon)"></path><path d="M16.9731 3.78947C16.9731 5.88234 15.2718 7.57895 13.1731 7.57895C11.0744 7.57895 9.37312 5.88234 9.37312 3.78947C9.37312 1.69661 11.0744 0 13.1731 0C15.2718 0 16.9731 1.69661 16.9731 3.78947Z" fill="url(#paint4_linear_icon)"></path><defs><linearGradient id="paint0_linear_icon" x1="1.9" y1="24" x2="26.4917" y2="-24.0554" gradientUnits="userSpaceOnUse"><stop stop-color="#239092"></stop><stop offset="0.624978" stop-color="#97C8C9"></stop></linearGradient><linearGradient id="paint1_linear_icon" x1="1.9" y1="24" x2="26.4917" y2="-24.0554" gradientUnits="userSpaceOnUse"><stop stop-color="#239092"></stop><stop offset="0.624978" stop-color="#97C8C9"></stop></linearGradient><linearGradient id="paint2_linear_icon" x1="1.9" y1="24" x2="26.4917" y2="-24.0554" gradientUnits="userSpaceOnUse"><stop stop-color="#239092"></stop><stop offset="0.624978" stop-color="#97C8C9"></stop></linearGradient><linearGradient id="paint3_linear_icon" x1="1.9" y1="24" x2="26.4917" y2="-24.0554" gradientUnits="userSpaceOnUse"><stop stop-color="#239092"></stop><stop offset="0.624978" stop-color="#97C8C9"></stop></linearGradient><linearGradient id="paint4_linear_icon" x1="1.9" y1="24" x2="26.4917" y2="-24.0554" gradientUnits="userSpaceOnUse"><stop stop-color="#239092"></stop><stop offset="0.624978" stop-color="#97C8C9"></stop></linearGradient></defs></svg>`
              }
            },
            {
              tag: "span",
              styles: {
                lineHeight: "2em",
              },
              properties: {
                innerText: "Build Graph"
              }
            }
          ],
          listeners: [
            {
              type: "click",
              listener: async () => {
                if (this.itemIDs.length == 0) {
                  new ztoolkit.ProgressWindow("Connected Papers")
                    .createLine({ text: "Please select a Zotero Item and click Add Origin first, then click Build Graph.", type: "connectedpapers"})
                    .show()
                  return
                }
                // 构建图谱
                const items = this.itemIDs.map((id: number) => Zotero.Items.get(id)) as Zotero.Item[]
                const graphdata = await this.refresh(items)
                if(!graphdata || !relatedContainer.isConnected || this.disposed) return;
                relatedContainer.querySelectorAll(".normal-items .item, .prior-items .item, .deriv-items .item").forEach(e => e.remove());
                ztoolkit.log("graphdata", graphdata)
                // @ts-ignore
                const app = this.frame.contentWindow.RefFlowGraph
                // app.graphdata = graphdata
                // items
                Object.values(graphdata.nodes).sort((a: any, b: any) => b.year - a.year).forEach((paper: any) => {
                  this.addItem(
                    relatedContainer.querySelector(".normal-items") as HTMLDivElement,
                    this.paper2Info(paper),
                    graphColor(paper),
                  )
                })
                // prior
                graphdata.common_references.sort((a: any, b: any) => b.year - a.year).forEach((paper: any) => {
                  const itemNode = this.addItem(
                    relatedContainer.querySelector(".prior-items") as HTMLDivElement,
                    this.paper2Info(paper),
                    graphColor(paper)
                  )
                  itemNode.setAttribute("local", paper.local_citations.join("+"))
                })
                // deriv
                graphdata.common_citations.sort((a: any, b: any) => b.year - a.year).forEach((paper: any) => {
                  const itemNode = this.addItem(
                    relatedContainer.querySelector(".deriv-items") as HTMLDivElement,
                    this.paper2Info(paper),
                    graphColor(paper)
                  )
                  itemNode.setAttribute("local", paper.local_references.join("+"))
                })
                
              }
            }
          ]
        },
        // node container
        {
          tag: "div",
          styles: {
            flexGrow: "1",
            overflowY: "auto",
            display: "flex",
            flexDirection: "row",
          },
          classList: ["items-container"],
          children: [
            {
              tag: "div",
              classList: ["prior-items"],
              styles: {
                display: "none",
                overflowY: "auto",
              }
            },
            {
              tag: "div",
              classList: ["normal-items"],
              styles: {
                overflowY: "auto"
              }
            },
            {
              tag: "div",
              classList: ["deriv-items"],
              styles: {
                display: "none",
                overflowY: "auto",
              }
            }
          ]
        },
        {
          tag: "div",
          styles: {
            display: "flex"
          },
          children: [
            {
              tag: "div",
              id: "prior-works",
              classList: ["filter-button"],
              properties: {
                innerText: "Prior Works"
              },
              listeners: [
                {
                  type: "click",
                  listener: () => {
                    const w1 = this.relatedContainer?.querySelector("#prior-works")!
                    const w2 = this.relatedContainer?.querySelector("#deriv-works")!
                    const i1 = this.relatedContainer!.querySelector(".prior-items") as HTMLDivElement
                    const i2 = this.relatedContainer!.querySelector(".deriv-items") as HTMLDivElement
                    const i0 = this.relatedContainer!.querySelector(".normal-items") as HTMLDivElement
                    w2.classList.remove("activate")
                    i2.style.display = "none"
                    i0.style.borderLeft = i0.style.borderRight = i1.style.borderLeft = i1.style.borderRight = "none"
                    if (w1?.classList.contains("activate")) {
                      w1.classList.remove("activate")
                      i1.style.display = "none"
                      i1.style.borderLeft = "none"
                      i0.style.borderRight = "none"
                      i0.style.width = "100%"
                    } else {
                      w1.classList.add("activate")
                      i1.style.display = ""
                      i0.style.width = i1.style.width = "50%"
                      i0.style.borderLeft = ".5px solid #cecece"
                      i1.style.borderRight = ".5px solid #cecece"
                    }
                  }
                }
              ]
            },
            {
              tag: "div",
              id: "deriv-works",
              classList: ["filter-button"],
              attributes: {
                activate: "false"
              },
              properties: {
                innerText: "Derivative Works"
              },
              listeners: [
                {
                  type: "click",
                  listener: () => {
                    const w2 = this.relatedContainer?.querySelector("#prior-works")!
                    const w1 = this.relatedContainer?.querySelector("#deriv-works")!
                    const i2 = this.relatedContainer!.querySelector(".prior-items") as HTMLDivElement
                    const i1 = this.relatedContainer!.querySelector(".deriv-items") as HTMLDivElement
                    const i0 = this.relatedContainer!.querySelector(".normal-items") as HTMLDivElement
                    w2.classList.remove("activate")
                    i2.style.display = "none"
                    i0.style.borderLeft = i0.style.borderRight = i1.style.borderLeft = i1.style.borderRight = "none"
                    if (w1?.classList.contains("activate")) {
                      w1.classList.remove("activate")
                      i1.style.display = "none"
                      i0.style.width = "100%"
                    } else {
                      w1.classList.add("activate")
                      i1.style.display = ""
                      i0.style.width = i1.style.width = "50%"
                      i0.style.borderRight = ".5px solid #cecece"
                      i1.style.borderLeft = ".5px solid #cecece"
                    }
                  }
                }
              ]
            }
          ]
        }
      ]
    }, box) as HTMLDivElement
    this.relatedContainer = relatedContainer
    for(const node of Array.from(relatedContainer.querySelectorAll('#add-origin,#remove-origin,#build-graph,#prior-works,#deriv-works')) as HTMLElement[]){
      node.setAttribute('role','button');node.tabIndex=0;
      node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();node.click();}});
    }

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
    let tipUI: TipUI, timer: number | undefined
    const originsAtRender=[...this.itemIDs];
    const itemNode: any = ztoolkit.UI.appendElement({
      tag: "div",
      classList: ["item"],
      attributes: {
        "zotero-item-id": info?._itemID
      },
      properties: {
        _ref: info
      },
      styles: {
        display: "flex",
        flexDirection: "row",
        height: "2em",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "0 .25em",
      },
      children: [
        {
          tag: "div",
          styles: {
            width: "2em",
            height: "2em",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          },
          children: [
            color
              ?
              {
                tag: "div",
                classList: ["color-circle"],
                styles: {
                  width: "1.2em",
                  height: "1.2em",
                  borderRadius: "50%",
                  backgroundColor: color
                },
                listeners: [
                  {
                    type: "mouseenter",
                    listener: () => {
                      this.setNodeState({ state: "hover", paperID: info.identifiers.paperID as string })
                    }
                  },
                  {
                    type: "mouseleave",
                    listener: () => {
                      this.setNodeState({ state: "hover", paperID: "" })
                    }
                  },
                  {
                    type: "click",
                    listener: () => {
                      this.setNodeState({ state: "selected", paperID: info.identifiers.paperID as string });
                      new ztoolkit.Clipboard().addText(info.identifiers!.DOI!, "text/unicode").copy()
                    }
                  }
                ]
              }
              :
              {
                tag: "div",
                styles: {
                  width: "2em",
                  height: "2em",
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center"
                },
                classList: ["icon"],
                properties: {
                  innerHTML: `<svg width="24" height="24" viewBox="0 0 24 24" fill="#7a306c" xmlns="http://www.w3.org/2000/svg" class="graph-action-icon mr-[6px]" data-v-f4c185ee=""><path d="M19 13H5V11H19V13Z"></path></svg>`
                },
                listeners: [
                  {
                    type: "click",
                    listener: () => {
                      this.itemIDs = this.itemIDs.filter(i => i != info._itemID);
                      itemNode.remove();
                      this.updateAddOrRemove()
                    }
                  }
                ]
              },
          ]
        },
        {
          tag: "div",
          classList: ["title-box"],
          styles: {
            width: "100%",
            height: "2em",
            flex: "1",
            boxSizing: "border-box",
          },
          children: [
            {
              tag: "div",
              namespace: "xul",
              classList: ["title"],
              styles: {
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                lineHeight: "2em"
              },
              properties: {
                textContent: info.title
              }
            }
          ],
          listeners: [
            {
              type: "mouseenter",
              listener: () => {
                // 图谱hover效果
                this.setNodeState({ state: "hover", paperID: info.identifiers.paperID as string })
              }
            },
            // 浮窗
            {
              type: "mouseup",
              listener: (event: any) => {
                if (event.button != 2 ){return }
                // 浮窗
                itemNode.classList.add("active")
                const rawTipTimeout = Zotero.Prefs.get(`${config.addonRef}.showTipAfterMillisecond`);
                let timeout = rawTipTimeout !== undefined ? parseInt(String(rawTipTimeout)) : 233;
                if (isNaN(timeout)) timeout = 233;
                const position = Zotero.Prefs.get("extensions.zotero.layout", true) == "stacked" ? "top center" : "left"
                timer = this.win.setTimeout(async () => {
                  const rect = itemNode.getBoundingClientRect() as any
                  tipUI = this.views.showTipUI(rect, info, position, info.identifiers.DOI, false, this.win)
                  if (!itemNode.classList.contains("active")) {
                    tipUI.container.style.display = "none"
                  }
                }, timeout);

              }
            },
            {
              type: "mouseleave",
              listener: () => {
                itemNode.classList.remove("active")
                this.win.clearTimeout(timer);
                if (!tipUI) { return }
                const timeout = tipUI.removeTipAfterMillisecond
                tipUI.tipTimer = this.win.setTimeout(async () => {
                  for (let i = 0; i < timeout / 2; i++) {
                    if (this.relatedContainer!.querySelector(".active")) { return }
                    await Zotero.Promise.delay(1 / 1000)
                  }
                  tipUI && tipUI.clear()
                }, timeout / 2)
              }
            },
            // 从列表定位到节点
            {
              type: "click",
              listener: () => {
                // 清除浮窗，定位
                tipUI && tipUI.clear()
                this.setNodeState({ state: "selected", paperID: info.identifiers.paperID as string })
                new ztoolkit.Clipboard().addText(info.identifiers!.DOI!, "text/unicode").copy()
              }
            }
          ]
        },
        
      ],
    }, parent)

    const importAction:any=ztoolkit.UI.appendElement({
      tag: "button",
      attributes:{type:'button',title:getString(info?._itemID?'cards-show-library':'cards-import'),'aria-label':getString(info?._itemID?'cards-show-library':'cards-import')},
      styles: {
        width: "2em",
        height: "2em",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        cursor: "pointer",
        background: 'transparent',border:'none',padding:'0',flexShrink:'0'
      },
      properties: {
        innerHTML: info?._itemID ?
          `<svg viewBox="0 0 743 743" width="1.2em" height="1.2em"  xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" overflow="hidden"><defs><clipPath id="clip0"><rect x="769" y="697" width="743" height="743"/></clipPath></defs><g transform="translate(-769 -697)"><path d="M769 1068.5C769 863.326 935.326 697 1140.5 697 1345.67 697 1512 863.326 1512 1068.5 1512 1273.67 1345.67 1440 1140.5 1440 935.326 1440 769 1273.67 769 1068.5Z" fill="#ca6363" fill-rule="evenodd"/><path d="M1162.25 901C1173.47 901 1181.89 904.166 1190.66 912.612L1316.22 1032.96C1327.09 1042.81 1332 1054.07 1332 1068.5 1332 1082.58 1326.74 1094.19 1316.22 1104.04L1190.66 1224.39C1181.89 1232.48 1173.47 1236 1162.25 1236 1141.2 1236 1126.12 1220.52 1126.12 1198.35 1126.12 1187.79 1130.68 1177.24 1138.75 1170.55L1178.73 1133.95 1215.56 1107.56 1143.66 1112.13 989.685 1112.13C965.838 1112.13 949 1093.13 949 1068.5 949 1043.52 965.838 1024.87 989.685 1024.87L1143.66 1024.87 1215.21 1029.09 1179.78 1003.05 1138.75 966.451C1130.68 959.766 1126.12 949.209 1126.12 938.3 1126.12 916.483 1141.2 901 1162.25 901Z" fill="#FFFFFF" fill-rule="evenodd"/></g></svg>`
          :
          `<svg viewBox="0 0 743 743" width="1.2em" height="1.2em" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" overflow="hidden"><defs><clipPath id="clip0"><rect x="944" y="711" width="743" height="743"/></clipPath></defs><g transform="translate(-944 -711)"><path d="M944 1082.5C944 877.326 1110.33 711 1315.5 711 1520.67 711 1687 877.326 1687 1082.5 1687 1287.67 1520.67 1454 1315.5 1454 1110.33 1454 944 1287.67 944 1082.5Z" fill="#9cb8b8" fill-rule="evenodd"/><path d="M1159.5 1083.5 1472.1 1083.5" stroke="#FFFFFF" stroke-width="87.0833" stroke-linecap="round" stroke-miterlimit="8" fill="none" fill-rule="evenodd"/><path d="M1316.5 927.5 1316.5 1240.1" stroke="#FFFFFF" stroke-width="87.0833" stroke-linecap="round" stroke-miterlimit="8" fill="none" fill-rule="evenodd"/></g></svg>`
      },
      listeners: [
        {
          type: "click",
          listener: async (event: any) => {
            event.stopPropagation();
            if(this.disposed||importAction.disabled||!itemNode.isConnected)return;
            if (info._itemID) {
              const existing=Zotero.Items.get(info._itemID as number);
              if(existing&&!existing.deleted)await this.views.utils.selectItemInLibrary(existing,this.win);
            } else {
              if(originsAtRender.join(',')!==this.itemIDs.join(','))return;
              const DOI = info.identifiers.DOI
              const originItems = originsAtRender.map(id => Zotero.Items.get(id)).filter((item): item is Zotero.Item => Boolean(item));
              
              let add = async (collections: number[]) => {
                if(this.disposed||importAction.disabled||!itemNode.isConnected||originsAtRender.join(',')!==this.itemIDs.join(','))return;
                importAction.disabled=true;importAction.setAttribute('aria-busy','true');importAction.title=getString('cards-importing-doi');
                let popupWin = new ztoolkit.ProgressWindow(getString('cards-importing-doi'), { closeTime: -1 })
                  .createLine({ text: DOI, type: "default" })
                  .show()
                try {
                  if (!originItems.length || originItems.length!==originsAtRender.length || originItems.some(item => item.deleted)) throw new Error(getString('graph-origins-changed'));
                  const result = await this.views.importReferences(originItems[0], [info], {
                    owner:this,collections, relatedParents: originItems.slice(1), downloadOA: false,
                    createSubCollection: false, createManifestNote: false
                  });
                  if (result.cancelled) throw new Error(getString('cards-import-cancelled'));
                  if (result.failedCount) throw new Error(importFailureText(result.failures[0]));
                  if(info._item)info._itemID=info._item.id;
                  popupWin.changeHeadline(getString('cards-import-complete'));popupWin.changeLine({ type: "success" });
                  if (!this.disposed&&itemNode.isConnected&&originsAtRender.join(',')===this.itemIDs.join(',')) (this.doc.querySelector("#build-graph") as HTMLDivElement)?.click();
                } catch (error) { popupWin.changeLine({ text: importErrorText(error), type: "fail" }); ztoolkit.log(error); }
                finally { popupWin.startCloseTimer(3000);importAction.disabled=false;importAction.removeAttribute('aria-busy');importAction.title=getString(info._itemID?'cards-show-library':'cards-import');importAction.setAttribute('aria-label',importAction.title); }
              }
              // 获取分类
              const collections: number[] = originItems[0]?this.views.utils.importCollections(originItems[0],this.win):[];
              if (event.ctrlKey || event.metaKey) {
                let rect = itemNode.getBoundingClientRect()
                // 构建分类选择
                let menuPopup = this.doc.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", 'menupopup') as XUL.MenuPopup;
                this.doc.querySelector("#browser")!.append(menuPopup);
                const libId = originItems[0]?.libraryID || 1;
                let collections = Zotero.Collections.getByLibrary(libId);
                for (let col of collections) {
                  let menuItem = Zotero.Utilities.Internal.createMenuForTarget(
                    col,
                    menuPopup,
                    null as any,
                    async (event: any, collection: any) => {
                      if (event.target.tagName == 'menuitem') {
                        ztoolkit.log(collection)
                        menuPopup.remove()
                        await add([collection.id])
                        event.stopPropagation();
                      }
                    }
                  );
                  menuPopup.append(menuItem);
                }
                // @ts-ignore
                menuPopup.openPopupAtScreen(rect.left, rect.top + rect.height, true);
              } else {
                await add(collections)
              }

            }
          }
        }
      ]
    }, itemNode)
    return itemNode
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
