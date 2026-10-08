import { config } from "../../package.json";
import { initLocale, getString } from "../utils/locale";
import TipUI from "./tip";
import Utils from "./utils";
import LocalStorge from "./localStorage";
import BatchImporter from "./batchImporter";
const localStorage = new LocalStorge(config.addonRef);

export default class Views {
  public utils!: Utils;
  constructor() {
    initLocale();
    this.utils = new Utils()
    this.addStyle()
  }

  private addStyle() {
    const styles = ztoolkit.UI.createElement(document, "style", {
      id: `${config.addonRef}-style`,
      properties: {
        innerHTML: `
          .reference-search-box .icon {
            display: flex;
            justify-content: center;
            align-items: center;
            opacity: 0.8;
          }
          .reference-search-box .icon:hover {
            opacity: 1;
          }
          .zotero-editpane-related .header {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 4px 6px;
            border-bottom: 1px solid var(--material-border, #e0e0e0);
          }
          .zotero-editpane-related .header label#reference-num {
            flex-grow: 1;
            font-weight: 500;
          }
          .zotero-editpane-related .header button {
            padding: 2px 8px;
            font-size: 12px;
            cursor: pointer;
            border-radius: 4px;
            border: 1px solid var(--material-border, #ccc);
            background: var(--material-button-background, #f5f5f5);
          }
          .zotero-editpane-related .header button:hover {
            background: var(--material-button-background-hover, #e8e8e8);
          }
        `
      },
    });
    document.documentElement.appendChild(styles);
  }
  /**
   * 注册阅读侧边栏
   */
  public async onInit() {
    this.registerReferenceItemPane();
    ztoolkit.ReaderTabPanel.register(
      getString("tabpanel-reader-tab-label"),
      (
        panel: XUL.TabPanel | undefined,
        deck: XUL.Deck,
        win: Window,
        reader: _ZoteroTypes.ReaderInstance
      ) => {
        if (!panel) {
          ztoolkit.log(
            "This reader do not have right-side bar. Adding reader tab skipped."
          );
          return;
        }
        let timer: number | undefined
        const id = `${config.addonRef}-${reader._instanceID}-extra-reader-tab-div`
        window.setTimeout(async () => {          
          const relatedbox = ztoolkit.UI.createElement(
            document,
            "related-box",
            {
              id,
              classList: ["zotero-editpane-related"],
              namespace: "xul",
              ignoreIfExists: true,
              attributes: {
                flex: "1",
              },
              styles: {
                alignItems: "center"
              },
              children: [
                {
                  tag: "box",
                  namespace: "xul",
                  classList: ["reference"],
                  attributes: {
                    flex: "1",
                  },
                  styles: {
                    display: "flex",
                    // paddingLeft: "0px",
                    // paddingRight: "0px"
                  },
                  children: [
                    {
                      tag: "div",
                      namespace: "html",
                      styles: {
                        flexGrow: "1",
                      },
                      children: [
                        {
                          tag: "div",
                          classList: ["header"],
                          namespace: "html",
                          children: [
                            {
                              tag: "label",
                              id: "reference-num",
                              properties: {
                                innerText: `0 ${getString("relatedbox-number-label")}`,
                                title: getString("relatedbox-copy-all-tooltip") || "双击复制全部参考文献列表 / Double-click to copy all references"
                              },
                              listeners: [
                                {
                                  type: "dblclick",
                                  listener: () => {
                                    ztoolkit.log("dblclick: Copy all references")
                                    let textArray: string[] = []
                                    let labels = relatedbox.querySelectorAll("#related-grid .box:not([style*='display: none']) #reference-label")
                                    if (labels.length === 0) {
                                      labels = relatedbox.querySelectorAll("#related-grid .box #reference-label")
                                    }
                                    if (labels.length === 0) return;
                                    labels.forEach((e: any) => {
                                      if (e.textContent) textArray.push(e.textContent)
                                    });
                                    if (textArray.length === 0) return;
                                    (new ztoolkit.ProgressWindow("Reference"))
                                      .createLine({ text: getString("relatedbox-copy-success") || "Copy all references", type: "success" })
                                      .show();
                                    (new ztoolkit.Clipboard())
                                      .addText(textArray.join("\n"), "text/unicode")
                                      .copy();
                                  }
                                }
                              ]
                            },
                            {
                              tag: "button",
                              id: "refresh-button",
                              properties: {
                                innerText: getString("relatedbox-refresh-label")
                              },
                              listeners: [
                                {
                                  type: "mousedown",
                                  listener: (event: any) => {
                                    timer = window.setTimeout(async () => {
                                      timer = undefined;
                                      // 不从本地储存读取，且不切换源
                                      await this.refreshReferences(panel, false, event.ctrlKey || event.metaKey, false);
                                    }, 1000);
                                  }
                                },
                                {
                                  type: "mouseup",
                                  listener: async (event: any) => {
                                    if (timer) {
                                      window.clearTimeout(timer);
                                      timer = undefined;
                                      // 本地储存读取，且切换源
                                      await this.refreshReferences(panel, true, event.ctrlKey || event.metaKey, true);
                                    }
                                  }
                                }
                              ]
                            },
                            {
                              tag: "button",
                              id: "batch-import-button",
                              properties: {
                                innerText: getString("relatedbox-batch-import") || "⚡ 批量导入"
                              },
                              listeners: [
                                {
                                  type: "click",
                                  listener: async (e: any) => {
                                    const btn = e?.target as HTMLButtonElement;
                                    const parentItem = this.utils.getItem();
                                    const refs: ItemBaseInfo[] = (panel as any).references;
                                    if (!parentItem || !refs || refs.length === 0) {
                                      (new ztoolkit.ProgressWindow("Batch Import"))
                                        .createLine({ text: getString("relatedbox-no-importable") || "未检测到可导入的参考文献", type: "fail" })
                                        .show();
                                      return;
                                    }
                                    if (btn) btn.disabled = true;
                                    try {
                                      await BatchImporter.importAll(parentItem, refs, {
                                        downloadOA: true,
                                        createSubCollection: true,
                                        createManifestNote: true
                                      });
                                      await this.refreshReferences(panel, true, false, false);
                                    } finally {
                                      if (btn) btn.disabled = false;
                                    }
                                  }
                                }
                              ]
                            },
                            {
                              tag: "button",
                              id: "rollback-button",
                              properties: {
                                innerText: getString("relatedbox-rollback") || "↩️ 撤回"
                              },
                              listeners: [
                                {
                                  type: "click",
                                  listener: async (e: any) => {
                                    const btn = e?.target as HTMLButtonElement;
                                    const parentItem = this.utils.getItem();
                                    if (!parentItem) return;
                                    const extra = (parentItem.getField("extra") as string) || "";
                                    const matches = [...extra.matchAll(/(?:refnexus_batch_parent|ref_batch_parent|import_batch):\s*(ref(?:nexus)?_batch_\w+)/g)];
                                    const targetBatch = matches.length > 0 ? matches[matches.length - 1][1] : undefined;
                                    if (targetBatch) {
                                      if (btn) btn.disabled = true;
                                      try {
                                        const count = await BatchImporter.rollbackBatch(parentItem, targetBatch);
                                        const tpl = getString("relatedbox-rollback-success") || "已成功撤回 { $count } 篇导入文献";
                                        (new ztoolkit.ProgressWindow("Rollback"))
                                          .createLine({ text: tpl.replace("{ $count }", String(count)), type: "success" })
                                          .show();
                                        await this.refreshReferences(panel, true, false, false);
                                      } finally {
                                        if (btn) btn.disabled = false;
                                      }
                                    } else {
                                      (new ztoolkit.ProgressWindow("Rollback"))
                                        .createLine({ text: getString("relatedbox-no-rollback-batch") || "未找到可撤回的批次记录", type: "fail" })
                                        .show();
                                    }
                                  }
                                }
                              ]
                            }
                          ]
                        },
                        {
                          tag: "div",
                          namespace: "html",
                          id: "related-grid",
                          classList: ["grid"],
                          styles: {
                            overflowY: "auto",
                            alignItems: "center",
                            display: "grid"
                          }
                        }
                      ]
                    },
                  ]
                }
              ],
            }
          );
  
          panel.append(relatedbox);
          relatedbox.querySelector("box:not(.reference)")?.remove()
          // 修改链接
          // window.setTimeout(async () => {
          //   await this.pdfLinks(reader, panel)
          // })
          // 自动刷新
          window.setTimeout(async () => {
            if (Zotero.Prefs.get(`${config.addonRef}.autoRefresh`)) {
              let rawExclude = Zotero.Prefs.get(`${config.addonRef}.notAutoRefreshItemTypes`);
              let excludeItemTypes = (rawExclude ? String(rawExclude) : "book, letter, note").split(/,\s*/);
              if (panel.getAttribute("isAutoRefresh") != "true" && reader?.itemID) {
                const rawItem = Zotero.Items.get(reader.itemID);
                const item = rawItem?.isAttachment() ? rawItem.parentItem : rawItem;
                if (!item) return;
                // @ts-ignore
                const id = typeof item.getType === "function" ? item.getType() : item.itemTypeID;
                const itemType = (typeof item.itemType === "string") ? item.itemType : Zotero.ItemTypes.getTypes().find(i => i.id == id)?.name as string;
                if (itemType && excludeItemTypes.indexOf(itemType) == -1) {
                  await this.refreshReferences(panel, true, false, false);
                  panel.setAttribute("isAutoRefresh", "true");
                }
              }
            }
          })
          // 推荐关联
          window.setTimeout(async () => {
            await this.loadingRelated();
          })
          // 分割按钮
          // window.setTimeout(async () => {
          //   await this.registerSplitButtons(reader);
          // })
        })
      },
      {
        // targetIndex: 3,
        tabId: config.addonRef,
        selectPanel: false,
      }
    )
  }

  /** Register the reference list as a native Zotero 10 item-pane section. */
  private registerReferenceItemPane() {
    const paneManager = Zotero.ItemPaneManager;
    if (!paneManager?.registerSection) {
      ztoolkit.log("Zotero 10 ItemPaneManager is unavailable; reference sidebar section was not registered");
      return;
    }

    const icon = `chrome://${config.addonRef}/content/icons/favicon@0.5x.png`;
    const paneID = `${config.addonRef}-references`;
    const registered = paneManager.registerSection({
      paneID,
      pluginID: config.addonID,
      sidenav: { l10nID: "refnexus-pane-title", icon },
      header: { l10nID: "refnexus-pane-title", icon: `chrome://${config.addonRef}/content/icons/favicon.png` },
      onRender: ({ body, item }) => {
        body.replaceChildren();
        body.classList.add("zotero-editpane-related");
        body.setAttribute("data-refnexus-item-id", String(item?.id || ""));
        body.setAttribute("source", (Zotero.Prefs.get(`${config.addonRef}.prioritySource`) as string) || "PDF");

        const controls = body.ownerDocument.createElement("div");
        controls.className = "header";
        const count = body.ownerDocument.createElement("label");
        count.id = "reference-num";
        count.textContent = `0 ${getString("relatedbox-number-label")}`;
        count.title = getString("relatedbox-copy-all-tooltip") || "Double-click to copy the reference list";
        const source = body.ownerDocument.createElement("select");
        source.setAttribute("aria-label", getString("relatedbox-source-label") || "Reference source");
        for (const [value, label] of [["PDF", "PDF"], ["API", "Online"]]) {
          const option = body.ownerDocument.createElement("option");
          option.value = value;
          option.textContent = label;
          source.append(option);
        }
        source.value = body.getAttribute("source") || "PDF";
        source.addEventListener("change", () => body.setAttribute("source", source.value));

        const refresh = body.ownerDocument.createElement("button");
        refresh.type = "button";
        refresh.textContent = getString("relatedbox-fetch-label") || "获取参考文献";
        refresh.addEventListener("click", async () => {
          const currentItem = Zotero.Items.get(Number(body.getAttribute("data-refnexus-item-id"))) as Zotero.Item | undefined;
          if (!currentItem || !currentItem.isRegularItem()) {
            count.textContent = getString("relatedbox-select-item") || "请先选择一篇文献";
            return;
          }
          refresh.disabled = true;
          try {
            await this.refreshReferences(body as any, true, false, false, currentItem);
          } catch (error) {
            ztoolkit.log("Item pane reference fetch failed:", error);
            count.textContent = getString("relatedbox-fetch-error") || "获取失败，请重试";
          } finally {
            refresh.disabled = false;
          }
        });
        controls.append(count, source, refresh);

        const grid = body.ownerDocument.createElement("div");
        grid.id = "related-grid";
        grid.className = "grid";
        grid.style.overflowY = "auto";
        body.append(controls, grid);
      },
      onItemChange: ({ body, item }) => {
        body.setAttribute("data-refnexus-item-id", String(item?.id || ""));
        body.querySelector("#related-grid")?.replaceChildren();
        const count = body.querySelector("#reference-num");
        if (count) count.textContent = `0 ${getString("relatedbox-number-label")}`;
      }
    });
    if (!registered) {
      ztoolkit.log("Zotero refused to register the RefNexus item-pane section");
    }
  }

  private async registerSplitButtons(reader: _ZoteroTypes.ReaderInstance) {
    let _window: any
    // @ts-ignore
    while (!(_window = reader?._iframeWindow?.wrappedJSObject)) {
      ztoolkit.log("wait...")
      await Zotero.Promise.delay(10)
    }
    const parent = _window.document.querySelector("#toolbarViewerLeft")!
    const ref = parent.querySelector("#pageNumber") as HTMLDivElement
    const styles = {
      backgroundSize: "16px 16px",
      backgroundPosition: "center",
      backgroundRepeat: "no-repeat",
      width: "16px"
    }
    
    ztoolkit.UI.insertElementBefore({
      tag: "div",
      classList: ["splitToolbarButton"],
      children: [
        {
          tag: "button",
          namespace: "html",
          id: "split-horizontally",
          classList: ["toolbarButton"],
          styles: {
            backgroundImage: `url(chrome://${config.addonRef}/content/icons/horizontally.png)`,
            // backgroundImage: await Zotero.File.generateDataURI(
            //   `chrome://${config.addonRef}/content/icons/horizontally.png`, 'image/png'
            // ),
            marginRight: "1px",
            ...styles
          },
          attributes: {
            title: "Split Horizontally",
            tabindex: "-1",
          },
          listeners: [
            {
              type: "click",
              listener: () => {
                reader.menuCmd("splitHorizontally")
              }
            }
          ]
        },
        {
          tag: "button",
          namespace: "html",
          id: "split-vertically",
          classList: ["toolbarButton"],
          styles: {
            backgroundImage: `url(chrome://${config.addonRef}/content/icons/split.png)`,
            // backgroundImage: await Zotero.File.generateDataURI(
            //   `chrome://${config.addonRef}/content/icons/vertically.png`, 'image/png'
            // ),
            marginLeft: "0",
            ...styles
          },
          attributes: {
            title: "Split Vertically",
            tabindex: "-1",
          },
          listeners: [
            {
              type: "click",
              listener: () => {
                reader.menuCmd("splitVertically")
              }
            }
          ]
        }
      ]
    }, ref)

    // ztoolkit.UI.appendElement({
    //   tag: "style",
    //   id: "reference-style",
    //   properties: {
    //     innerHTML: `
    //       #split-horizontally.toolbarButton::before {
    //         background-image: url("chrome://${config.addonRef}/content/icons/horizontally.png");
    //       }
    //       #split-vertically.toolbarButton::before {
    //         background-image: url("chrome://${config.addonRef}/content/icons/vertically.png");
    //       }
    //     `
    //   },
    // }, ((_window.document as Document).documentElement));
  }

  /**
   * 刷新推荐相关
   * @param array 
   * @param node 
   * @returns 
   */
  public refreshRelated(array: ItemBaseInfo[], node: HTMLDivElement) {
    let totalNum = 0;
    const fragment = document.createDocumentFragment();
    const rows = ((node.querySelector("#related-grid") || node) as HTMLDivElement);
    // @ts-ignore
    array.forEach((info: ItemBaseInfo, i: number) => {
      let rowResult = this.addRow(node, array, i, false, false, false) as any;
      if (!rowResult?.box || !rowResult?.label) { return; }
      rowResult.box.classList.add("only-title");
      totalNum += 1;
      fragment.append(rowResult.box, rowResult.label);
    });
    if (rows) {
      rows.append(fragment);
    }
    return totalNum;
  }

  /**
 * Only item with DOI is supported
 * @returns 
 */
  async loadingRelated() {
    if (!Zotero.Prefs.get(`${config.addonRef}.loadingRelated`)) { return }
    ztoolkit.log("loadingRelated");
    let item = this.utils.getItem() as Zotero.Item
    if (!item) { return }
    let itemDOI = item.getField("DOI") as string
    if (!itemDOI || !this.utils.isDOI(itemDOI)) {
      ztoolkit.log("Not DOI", itemDOI);
      return
    }
    const context = document.querySelector(`#${Zotero_Tabs.selectedID}-context`);
    const relatedbox = context?.querySelector("tabpanel:nth-child(3) related-box") as any;
    if (!relatedbox) return;
    let waitAttempts = 0;
    while (!relatedbox.querySelector("#related-grid") && waitAttempts < 20) {
      await Zotero.Promise.delay(50);
      waitAttempts++;
    }
    const grid = relatedbox.querySelector("#related-grid");
    if (!grid) return;
    
    const node = grid.parentElement;
    if (!node) return;
    // 已经刷新过
    if (node.querySelector(".zotero-clicky-plus")) { return }
    ztoolkit.log("getDOIRelatedArray")
    let _relatedArray = (await this.utils.API.getDOIRelatedArray(itemDOI)) as ItemBaseInfo[] || []
    let func = relatedbox.refresh
    relatedbox.refresh = () => {
      func.call(relatedbox)
      // #42，为Zotero相关条目添加悬浮提示
      // 把Zotero条目转化为Reference可识别形式
      node.querySelectorAll(".box").forEach((e: any) => { e.nextElementSibling?.remove(); e.remove();  })
      ztoolkit.log(_relatedArray)
      let relatedArray = (item.relatedItems.map((key: string) => {
        try {
          return Zotero.Items.getByLibraryAndKey(item.libraryID || 1, key) as Zotero.Item
        } catch { }
      })
        .filter(i => i) as Zotero.Item[])
        .map((item: Zotero.Item) => {
          return {
            identifiers: { DOI: item.getField("DOI") },
            authors: [],
            title: item.getField("title"),
            text: item.getField("title"),
            url: item.getField("url"),
            type: item.itemType,
            year: item.getField("year"),
            _item: item
          } as ItemBaseInfo
        }).concat(_relatedArray)
      ztoolkit.log(relatedArray)
      this.refreshRelated(relatedArray, node)

    }
    relatedbox.refresh()
  }

  private async getReaderForItem(item: Zotero.Item): Promise<_ZoteroTypes.ReaderInstance | undefined> {
    const isSameItem = (reader?: _ZoteroTypes.ReaderInstance) => {
      const readerItem = (reader as any)?._item as Zotero.Item | undefined;
      return Boolean(reader && ((reader as any).itemID === item.id || readerItem?.parentItem?.id === item.id || readerItem?.id === item.id));
    };
    const active = this.utils.getReader();
    if (isSameItem(active)) return active;

    let attachments: Zotero.Item[] = [];
    try {
      const attachmentIDs = item.getAttachments();
      attachments = await (Zotero.Items as any).getAsync(attachmentIDs);
    } catch (error) {
      ztoolkit.log("Could not list PDF attachments:", error);
    }
    let attachment = attachments.find(candidate => candidate.attachmentContentType === "application/pdf");
    if (!attachment) {
      try {
        const best = await item.getBestAttachment();
        if (best && best.attachmentContentType === "application/pdf") attachment = best;
      } catch {}
    }
    if (!attachment) return undefined;

    const opened = await Zotero.Reader.open(attachment.id, undefined, { openInBackground: true });
    if (opened && isSameItem(opened)) return opened;
    for (let attempt = 0; attempt < 50; attempt++) {
      const readers = ((Zotero.Reader as any)._readers || []) as _ZoteroTypes.ReaderInstance[];
      const reader = readers.find(isSameItem);
      if (reader) return reader;
      await Zotero.Promise.delay(100);
    }
    return undefined;
  }

  public async pdfLinks(reader: _ZoteroTypes.ReaderInstance, panel: XUL.TabPanel) {
    let _pdfDocument: any, _window: any
    // @ts-ignore
    while (!((_window = reader?._iframeWindow?.wrappedJSObject) && (_pdfDocument = _window.PDFViewerApplication?.pdfDocument))) {
      await Zotero.Promise.delay(10)
    }
    // let refKeys: any = []
    const dests = await _pdfDocument._transport.getDestinations()
    // window.setTimeout(async () => {
    //   dests = await _pdfDocument._transport.getDestinations()
    //   // 分析href与参考文献对应
    //   // 统计与参考文献数量一致的引文
    //   const statistics: any = {}
    //   Object.keys(dests).forEach(key => {
    //     let _key = key.replace(/\d/g, "")
    //     statistics[_key] ??= 0
    //     statistics[_key] += 1
    //   })
    //   // const totalNum = 36
    //   // let refKey = Object.keys(statistics).find(k => statistics[k] == totalNum)
    //   // 用最大值概率最大，但是有一定风险
    //   let refKey = Object.keys(statistics).sort((k1, k2) => statistics[k2]- statistics[k1])[0]
    //   Object.keys(dests).forEach(key => {
    //     if (key.replace(/\d/g, "") == refKey) {
    //       refKeys.push(key)
    //     }
    //   })
    //   // 根据匹配数字排序
    //   refKeys = refKeys.sort((k1: string, k2: string) => {
    //     let n1 = Number(k1.match(/\d+/)![0])
    //     let n2 = Number(k2.match(/\d+/)![0])
    //     return n1 - n2
    //   })
    if ((panel as any)._refnexus_pdfLinks_timer) {
      window.clearInterval((panel as any)._refnexus_pdfLinks_timer);
      (panel as any)._refnexus_pdfLinks_timer = null;
    }
    let id = window.setInterval(async () => {
      if (!panel.isConnected || !reader || (reader as any)._destroyed) {
        window.clearInterval(id);
        (panel as any)._refnexus_pdfLinks_timer = null;
        return;
      }
      try {
        if (!_window?.document) throw new Error("Document detached");
      } catch (e) {
        window.clearInterval(id);
        (panel as any)._refnexus_pdfLinks_timer = null;
        if (panel.isConnected) {
          return await this.pdfLinks(reader, panel);
        }
        return;
      }
      
      _window.document
        .querySelectorAll(`section.linkAnnotation a[href^='#']:not([${config.addonRef}])`).forEach(async (a: any) => {
          const isClickLink = Zotero.Prefs.get(`${config.addonRef}.clickLink`) as boolean
          const isHoverLink = Zotero.Prefs.get(`${config.addonRef}.hoverLink`) as boolean
          let _a: any, href = a.getAttribute("href")
          if (href.indexOf("fig") >=0) {return }
          if (isClickLink) {
            _a = ztoolkit.UI.appendElement({
              tag: "a",
              namespace: "html"
            }, a.parentNode) as HTMLDivElement
            _a.setAttribute(config.addonRef, href);
            _a.setAttribute("style", "cursor: pointer;")
            a.remove()
            _a.addEventListener("click", async (event: MouseEvent) => {
              event.stopPropagation();
              event.preventDefault();
              if (_window.secondViewIframeWindow == null) {
                await reader.menuCmd(
                  Zotero.Prefs.get(`${config.addonRef}.clickLink.cmd`) as any
                )
                while (
                  !(
                    _window?.secondViewIframeWindow?.PDFViewerApplication?.pdfDocument
                  )
                ) {
                  await Zotero.Promise.delay(100)
                }
                await Zotero.Promise.delay(1000)
              }
              // let dest = unescape()
              // 有报错，#39 
              _window.secondViewIframeWindow.eval(`PDFViewerApplication
                .pdfViewer.linkService.goToDestination("${href.slice(1) }")`)

            })
          }
          
          let timer: undefined | number
          _a = _a || a
          if (isHoverLink) {
            let tipUI: TipUI
            _a.addEventListener("mouseenter", async (event: MouseEvent) => {
              // @ts-ignore
              const references = panel.references
              if (!references) { return }
              const dest = dests?.[href.slice(1)];
              if (!dest || !Array.isArray(dest) || dest.length < 4) { return; }
              const [x, y] = dest.slice(2, 4)
              // 确定 refIndex，过滤无坐标引文避免 NaN 污染
              const distances = references.map((ref: { x: number; y: number }) => {
                return (typeof ref?.x === "number" && typeof ref?.y === "number") ? ((x - ref.x) ** 2 + (y - ref.y) ** 2) : Infinity;
              });
              const minDistance = [...distances].sort((a: number, b: number) => a - b)[0];
              const refIndex = (minDistance !== Infinity && !isNaN(minDistance)) ? distances.indexOf(minDistance) : -1;
              let reference = refIndex >= 0 ? references[refIndex] : undefined;
              if (reference) {
                timer = window.setTimeout(() => {
                  timer = undefined
                  let rect = _a.getBoundingClientRect()
                  rect.y = rect.y + 40;
                  tipUI = this.showTipUI(
                    rect,
                    reference,
                    "top center"
                  )
                }, 233)
              }
            })
            _a.addEventListener("mouseleave", async () => {
              window.clearTimeout(timer)
              if (tipUI) {
                const timeout = tipUI.removeTipAfterMillisecond
                tipUI.tipTimer = window.setTimeout(async () => {
                  tipUI && tipUI.container.remove()
                }, timeout)
              }
            })
          }
        })
    }, 100)
  }

  /**
   * 刷新按钮触发
   * @param local 是否允许从本地读取
   * @param fromCurrentPage 从当前页向前查询参考文献
   * @returns 
   */
  public async refreshReferences(
    panel: XUL.TabPanel,
    local: boolean = true,
    fromCurrentPage: boolean = false,
    toggleSource: boolean = false,
    itemOverride?: Zotero.Item,
    readerOverride?: _ZoteroTypes.ReaderInstance
  ) {
    Zotero.ProgressWindowSet.closeAll();
    let label = panel.querySelector("label#reference-num") as XUL.Label;
    const initialSource = panel.getAttribute("source") || "PDF";
    label.innerText = `${0} ${getString("relatedbox-number-label")} [${initialSource}]`;
    let source = panel.getAttribute("source");
    if (source) {
      if (toggleSource) {
        if (source === "PDF") {
          panel.setAttribute("source", "API");
        } else if (source === "API") {
          panel.setAttribute("source", "PDF");
        }
      }
    } else {
      panel.setAttribute("source", (Zotero.Prefs.get(`${config.addonRef}.prioritySource`) as string) || "PDF");
    }

    // clear 
    panel.querySelectorAll("#related-grid *").forEach(e => e.remove());
    panel.querySelectorAll(`#${config.addonRef}-search`).forEach(e => e.remove());
    const gridEl = panel.querySelector("#related-grid");
    if (gridEl) {
      (gridEl as any)._seenTexts = new Set<string>();
    }

    let references: ItemBaseInfo[];
    let item = (itemOverride || this.utils.getItem()) as Zotero.Item;
    let reader = readerOverride || this.utils.getReader();
    if (reader && item) {
      const readerItem = (reader as any)._item as Zotero.Item | undefined;
      const readerParentID = readerItem?.parentItem?.id || readerItem?.id;
      if (readerParentID && readerParentID !== item.id) reader = undefined as any;
    }
    if (!reader && item && panel.getAttribute("source") === "PDF") {
      reader = await this.getReaderForItem(item) as any;
    }

    if (!local && item) {
      // 强制刷新：清理当前源在 LocalStorage 中的缓存
      const currentSource = panel.getAttribute("source") || "PDF";
      const key = currentSource === "PDF" ? "References-PDF" : "References-API";
      await localStorage.delete(item, key);
    }

    if (panel.getAttribute("source") == "PDF") {
      // 优先本地读取
      const key = "References-PDF";
      references = local ? (await localStorage.getAsync(item, key)) : undefined;
      if (references) {
        (new ztoolkit.ProgressWindow("[Local] PDF"))
          .createLine({ text: `${references.length} references`, type: "success"})
          .show();
      } else {
        if (!reader) {
          references = [];
          (new ztoolkit.ProgressWindow("[PDF unavailable]"))
            .createLine({ text: "Open this item's PDF in the Zotero reader to extract its references", type: "fail" })
            .show();
        } else {
          references = await this.utils.PDF.getReferences(reader, fromCurrentPage);
        }
        if (references.length && Zotero.Prefs.get(`${config.addonRef}.savePDFReferences`)) {
          window.setTimeout(async () => {
            await localStorage.set(item, key, references);
          });
        }
      }
    } else {
      const key = "References-API";
      references = local ? (await localStorage.getAsync(item, key)) : undefined;
      if (references) {
        (new ztoolkit.ProgressWindow("[Local] API"))
          .createLine({ text: `${references.length} references`, type: "success" })
          .show();
      } else {
        
        let DOI = item.getField("DOI") as string;
        let url = item.getField("url") as string;
        let title = item.getField("title") as string;

        let fileName = this.utils.parseCNKIURL(url)?.fileName;
        let popupWin: any;
        try {
          if (this.utils.isDOI(DOI)) {
            popupWin = new ztoolkit.ProgressWindow("[Pending] API", { closeTime: -1 });
            popupWin
              .createLine({ text: "Request DOI references...", type: "default" })
              .show();
            references = (await this.utils.API.getDOIInfoByCrossref(DOI))?.references!;
          } else if (this.utils.isChinese(title) || fileName) {
            // 知网文献处理
            if (!fileName) {
              try {
                let url = (await this.utils.API.getCNKIURL(title)) as string;
                if (url) {
                  fileName = this.utils.parseCNKIURL(url)?.fileName;
                  item.setField("url", url);
                  await item.saveTx();
                }
              } catch {
                (new ztoolkit.ProgressWindow("[Fail] API"))
                  .createLine({ text: `Error, Get CNKI URL`, type: "fail" })
                  .show();
                return;
              }
              if (!fileName) {
                (new ztoolkit.ProgressWindow("[Fail] API"))
                  .createLine({ text: `Fail, Get CNKI URL`, type: "fail" })
                  .show();
                return;
              }
            }
            popupWin = new ztoolkit.ProgressWindow("[Pending] API", { closeTime: -1, closeOtherProgressWindows: true });
            popupWin
              .createLine({ text: "Request CNKI references...", type: "default" })
              .show();
            references = (await this.utils.API.getCNKIFileInfo(fileName))?.references!;
            if (!references) {
              popupWin.changeHeadline("[Fail] API");
              popupWin.changeLine({ text: `Not Supported, ${fileName}`, type: "fail" });
              popupWin.startCloseTimer(3000);
              return;
            }
          } else {
            // 国际文献无 DOI：通过多源联邦解析器解析 DOI
            popupWin = new ztoolkit.ProgressWindow("[Pending] API", { closeTime: -1 });
            popupWin.createLine({ text: "Resolving Title to DOI...", type: "default" }).show();
            const firstAuthor = (item.getCreators()?.[0] as any)?.name || (item.getCreators()?.[0] as any)?.lastName;
            const date = item.getField("date") as string;
            const resolved = await this.utils.API.resolveWork(title, firstAuthor, date);
            if (resolved?.doi) {
              DOI = resolved.doi;
              item.setField("DOI", DOI);
              try { await item.saveTx(); } catch {}
              popupWin.changeLine({ text: `Found DOI: ${DOI}, fetching references...`, type: "default" });
              references = (await this.utils.API.getDOIInfoByCrossref(DOI))?.references!;
            }
          }

          // 若 API 未能获取到参考文献，且当前存在 PDF reader，优雅降级至本地 PDF 智能提取
          if ((!references || references.length === 0) && reader) {
            if (!popupWin) {
              popupWin = new ztoolkit.ProgressWindow("[Fallback] PDF", { closeTime: -1 });
              popupWin.show();
            }
            popupWin.changeHeadline("[Fallback] PDF");
            popupWin.changeLine({ text: "API未收录引文，正在启用本地 PDF 解析...", type: "default" });
            try {
              references = await this.utils.PDF.getReferences(reader, fromCurrentPage);
            } catch (pdfErr) {
              ztoolkit.log("PDF fallback error:", pdfErr);
            }
          }

          if (Zotero.Prefs.get(`${config.addonRef}.saveAPIReferences`)) {
            window.setTimeout(async () => {
              references && await localStorage.set(item, key, references);
            });
          }
          if (popupWin) {
            popupWin.changeHeadline(references?.length ? "[Done]" : "[Empty]");
            popupWin.changeLine({ text: `${references?.length || 0} references`, type: references?.length ? "success" : "fail" });
            popupWin.startCloseTimer(3000);
          }
        } catch (apiErr) {
          ztoolkit.log("refreshReferences API error:", apiErr);
          if (popupWin) {
            popupWin.changeHeadline("[Fail] API");
            popupWin.changeLine({ text: "API请求失败，请稍后重试", type: "fail" });
            popupWin.startCloseTimer(3000);
          }
        }
      }
    }

    if (!references) {
      references = [];
    }
    const referenceNum = references.length;
    // @ts-ignore
    panel.references = references;

    const currentSource = panel.getAttribute("source") || "PDF";
    const refreshBtn = panel.querySelector("#refresh-button") as HTMLButtonElement;
    if (refreshBtn) {
      const tooltipTpl = getString("relatedbox-source-tooltip") || "当前来源: { $source } (点击切换模式，长按强制更新)";
      refreshBtn.title = tooltipTpl.replace("{ $source }", currentSource);
    }

    if (referenceNum === 0) {
      label.innerText = `0 ${getString("relatedbox-number-label")} [${currentSource}]`;
      return;
    }
    const fragment = document.createDocumentFragment();
    for (let refIndex = 0; refIndex < referenceNum; refIndex++) {
      const reference = references[refIndex];
      const rowResult = this.addRow(panel, references, refIndex, true, false, false);
      if (rowResult?.box && rowResult?.label) {
        // @ts-ignore
        rowResult.box.reference = reference;
        fragment.append(rowResult.box, rowResult.label);
      }
    }
    const rows = ((panel.querySelector("#related-grid") || panel) as HTMLDivElement);
    if (rows) {
      rows.append(fragment);
      if (!panel.querySelector(`#${config.addonRef}-search`)) {
        this.addSearch(panel);
      }
      if (rows.getBoundingClientRect) {
        const top = rows.getBoundingClientRect().top;
        const totalH = document.documentElement?.getBoundingClientRect()?.height || window.innerHeight || 800;
        if (top > 0 && totalH > top) {
          rows.style.maxHeight = `${totalH - top}px`;
        }
      }
    }

    label.innerText = `${referenceNum} ${getString("relatedbox-number-label")} [${currentSource}]`;
  }

  public showTipUI(refRect: Rect, reference: ItemInfo, position: string, idText?: string) {
    let toTimeInfo = (t: string) => {
      if (!t) { return undefined }
      let info = (new Date(t)).toString().split(" ")
      return `${info[1]} ${info[3]}`
    }
    let tipUI = new TipUI()
    tipUI.onInit(refRect, position)
    const refText = reference.text!;
    let getDefalutInfoByReference = async () => {
      const localItem = reference._item
      let info: ItemInfo
      if (localItem) {
        info = {
          identifiers: {},
          authors: localItem.getCreators().map((i: any) => i.firstName + " " + i.lastName),
          tags: localItem.getTags().map((i: any) => {
            let ctag: any = localItem.getColoredTags().find((ci: any) => ci.tag == i.tag)
            if (ctag) {
              return {text: i.tag, color: ctag.color}
            } else {
              return i.tag
            }
          }),
          abstract: localItem.getField("abstractNote") as string,
          title: localItem.getField("title") as string,
          year: localItem.getField("year") as string,
          primaryVenue: localItem.getField("publicationTitle") as string,
          type: "",
          source: reference.source || undefined
        }
      } else {
        info = {
          identifiers: reference.identifiers || {},
          authors: reference.authors || [],
          type: "",
          year: reference.year || undefined,
          title: reference.title || idText || "Reference",
          tags: reference.tags || [],
          text: reference.text || refText,
          abstract: reference.abstract || refText,
          primaryVenue: reference.primaryVenue || undefined
          
        }
        let url = this.utils.identifiers2URL(info.identifiers)
        if (url) {
          info.url = url
        }
      }
      return info
    }
    let coroutines: Promise<ItemInfo | undefined>[], prefIndex: number, according: string
    if (reference?.identifiers.arXiv) {
      according = "arXiv"
      coroutines = [
        getDefalutInfoByReference(),
        this.utils.API.getArXivInfo(reference.identifiers.arXiv)
      ]
      prefIndex = parseInt(Zotero.Prefs.get(`${config.addonRef}.${according}InfoIndex`) as string)
    } else if (reference?.identifiers.DOI) {
      according = "DOI"
      coroutines = [
        getDefalutInfoByReference(),
        this.utils.API.getDOIInfoBySemanticscholar(reference.identifiers.DOI),
        this.utils.API.getTitleInfoByReadpaper(refText, {}, reference.identifiers.DOI),
        this.utils.API.getTitleInfoByConnectedpapers(reference.identifiers.DOI),
        this.utils.API.getDOIInfoByCrossref(reference.identifiers.DOI)
      ]
      prefIndex = parseInt(Zotero.Prefs.get(`${config.addonRef}.${according}InfoIndex`) as string)
    } else {
      according = "Title";
      const searchTitle = reference.title || reference.text || "";
      coroutines = [
        getDefalutInfoByReference(),
        this.utils.API.getTitleInfoByReadpaper(searchTitle),
        this.utils.API.getTitleInfoByCrossref(searchTitle),
        this.utils.API.openAlex.searchWorkByTitle(searchTitle).then(oa => {
          if (!oa) return undefined;
          return {
            identifiers: oa.doi ? { DOI: oa.doi } : {},
            title: oa.title,
            authors: oa.authors,
            year: oa.year,
            type: "journalArticle",
            primaryVenue: oa.venue,
            source: "openalex",
            url: oa.doi ? `https://doi.org/${oa.doi}` : undefined,
            oaUrl: oa.oaUrl,
            tags: oa.citationCount ? [{ text: `Cited: ${oa.citationCount}`, color: "#d9480f", tip: "Citations (OpenAlex)" }] : []
          } as ItemInfo;
        }),
        this.utils.API.getTitleInfoByConnectedpapers(searchTitle),
        this.utils.API.getTitleInfoByCNKI(searchTitle)
      ];
      prefIndex = parseInt(Zotero.Prefs.get(`${config.addonRef}.${according}InfoIndex`) as string);
    }
    const sourceConfig = {
      arXiv: { color: "#b31b1b", tip: "arXiv is a free distribution service and an open-access archive for 2,186,475 scholarly articles in the fields of physics, mathematics, computer science, quantitative biology, quantitative finance, statistics, electrical engineering and systems science, and economics. Materials on this site are not peer-reviewed by arXiv." },
      readpaper: { color: "#1f71e0", tip: "论文阅读平台ReadPaper共收录近2亿篇论文、2.7亿位作者、近3万所高校及研究机构，几乎涵盖了全人类所有学科。科研工作离不开论文的帮助，如何读懂论文，读好论文，这本身就是一个很大的命题，我们的使命是：“让天下没有难读的论文”" },
      semanticscholar: { color: "#1857b6", tip: "Semantic Scholar is an artificial intelligence–powered research tool for scientific literature developed at the Allen Institute for AI and publicly released in November 2015. It uses advances in natural language processing to provide summaries for scholarly papers. The Semantic Scholar team is actively researching the use of artificial-intelligence in natural language processing, machine learning, Human-Computer interaction, and information retrieval." },
      crossref: { color: "#89bf04", tip: "Crossref is a nonprofit association of approximately 2,000 voting member publishers who represent 4,300 societies and publishers, including both commercial and nonprofit organizations. Crossref includes publishers with varied business models, including those with both open access and subscription policies." },
      connectedpapers: { color: "#35999a", tip: "Connected Papers is a visual tool to help researchers and applied scientists find academic papers relevant to their field of work."},
      openalex: { color: "#d9480f", tip: "OpenAlex is a free and open bibliographic database of global scholarly research with over 250M works, indexing citations and open-access links." },
      DOI: { color: "#fcb426" },
      Zotero: { color: "#d63b3b", tip: "Zotero is a free, easy-to-use tool to help you collect, organize, cite, and share your research sources." },
      CNKI: { color: "#1b66e6", tip: "中国知网知识发现网络平台—面向海内外读者提供中国学术文献、外文文献、学位论文、报纸、会议、年鉴、工具书等各类资源统一检索、统一导航、在线阅读和下载服务。" }
    }
    for (let i = 0; i < coroutines.length; i++) {
      // 不阻塞
      window.setTimeout(async () => {
        let info = await coroutines[i].catch(e => {
          ztoolkit.log("Tip coroutine error:", e);
          return undefined;
        });
        if (!info) { return }
        const tagDefaultColor = "#59C1BD"
        let tags = (info.tags || []).map((tag: object | string) => {
          if (typeof tag == "object") {
            return { color: tagDefaultColor, ...(tag as object) }
          } else {
            return { color: tagDefaultColor, text: tag }
          }
        }) as any || []
        // 展示撤稿警示 tag
        if (reference.retraction?.isRetracted) {
          tags.unshift({
            text: getString("relatedbox-retracted-badge") || "🚨 已撤稿",
            color: "#e03131",
            tip: reference.retraction.reason || getString("relatedbox-retracted-reason") || "该论文已被学术期刊或机构撤回"
          });
        }
        // 展示当前数据源tag
        if (info.source) { tags.push({ text: info.source, ...sourceConfig[info.source as keyof typeof sourceConfig], source: info.source }) }
        // 展示可点击跳转链接tag
        if (info.identifiers?.DOI) {
          let DOI = info.identifiers.DOI
          tags.push({ text: "DOI", color: sourceConfig.DOI.color, tip: DOI, url: info.url })
        }
        if (info.identifiers?.arXiv) {
          let arXiv = info.identifiers.arXiv
          tags.push({ text: "arXiv", color: sourceConfig.arXiv.color, tip: arXiv, url: info.url })
        }
        if (info.identifiers?.CNKI) {
          let url = info.identifiers.CNKI
          tags.push({ text: "URL", color: sourceConfig.CNKI.color, tip: url, url: info.url })
        }
        if (reference._item) {
          // 用本地Item更新数据
          tags.push({ text: "Zotero", color: sourceConfig.Zotero.color, tip: sourceConfig.Zotero.tip, item: reference._item })
        }
        // 添加
        tipUI.addTip(
          this.utils.Html2Text(info.title!)!,
          tags,
          [
            info.authors?.slice(0, 3).join(" / "),
            [info?.primaryVenue, toTimeInfo(info.publishDate as string) || info.year]
              .filter(e => e).join(" \u00b7 "),
            reference.description
          ].filter(s => s && s != ""),
          this.utils.Html2Text(info.abstract!)!,
          according,
          i,
          prefIndex
        )
      })
    }
    return tipUI
  }

  public addRow(node: HTMLDivElement, references: ItemBaseInfo[], refIndex: number, addPrefix: boolean = true, addSearch: boolean = true, appendToDOM: boolean = true) {
    let notInLibarayOpacity: string|number = Zotero.Prefs.get(`${config.addonRef}.notInLibarayOpacity`) as string
    if (/[\d\.]+/.test(notInLibarayOpacity)) {
      notInLibarayOpacity = Number(notInLibarayOpacity);
    } else {
      notInLibarayOpacity = 1
    }
    let reference = references[refIndex]
    // 非阻塞搜索
    let refText: string
    if (addPrefix) {
      refText = `[${reference?.number || (refIndex + 1)}] ${reference.text}`
    } else {
      refText = reference.text!
    }
    // 避免重复添加 (使用 O(1) Set 索引消除 O(N^2) DOM 树遍历)
    let toText = (s: string) => s.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "");
    const rows = ((node.querySelector("#related-grid") || node) as HTMLDivElement);
    if (!rows) return;
    if (!(rows as any)._seenTexts) {
      (rows as any)._seenTexts = new Set<string>();
    }
    const cleanRef = toText(refText);
    if ((rows as any)._seenTexts.has(cleanRef)) {
      return;
    }
    (rows as any)._seenTexts.add(cleanRef);
    // id描述
    let idText = (
      reference.identifiers
      && Object.values(reference.identifiers).length > 0
      && Object.keys(reference.identifiers)[0] + ": " + Object.values(reference.identifiers)[0]
    ) || "Reference"
    // 当前item
    let item = this.utils.getItem()!
    let editTimer: number | undefined
    const box = ztoolkit.UI.createElement(
      document,
      "div",
      {
        namespace: "html",
        classList: ["box", "zotero-clicky"],
        listeners: [
          {
            type: "click",
            listener: (event: any) => {
              event.preventDefault()
              event.stopPropagation()
            }
          },
          {
            type: "mouseup",
            listener: async (event: any) => {
              event.preventDefault()
              event.stopPropagation()
              // ctrl点击跳转本地item/url
              if (event.ctrlKey || event.metaKey) {
                window.clearTimeout(editTimer)
                if (reference._item) {
                  return this.utils.selectItemInLibrary(reference._item)
                } else {
                  let item = await this.utils.searchLibraryItem(reference)
                  if (item) {
                    return this.utils.selectItemInLibrary(item)
                  }
                }
                let URL = reference.url
                if (!URL) {
                  const refText = reference.text!
                  let info: ItemBaseInfo = this.utils.refText2Info(refText);
                  const popupWin = (new ztoolkit.ProgressWindow("Searching URL", { closeTime: -1 }))
                    .createLine({ text: `Title: ${reference.title || info.title || "Reference"}`, type: "default" })
                    .show()
                  try {
                    if (this.utils.isChinese(refText)) {
                      URL = (await this.utils.API.getCNKIURL(info.title)) as string;
                    } else {
                      let DOI = reference.identifiers?.DOI;
                      if (!DOI) {
                        const resolved = await this.utils.API.resolveWork(reference.title || info.title, info.authors?.[0], info.year);
                        DOI = resolved?.doi;
                        if (!DOI && resolved?.oaUrl) {
                          URL = resolved.oaUrl;
                        }
                      }
                      if (DOI) {
                        URL = this.utils.identifiers2URL({ DOI });
                      }
                    }
                  } catch (searchUrlErr) {
                    ztoolkit.log("Searching URL error:", searchUrlErr);
                  } finally {
                    popupWin.close();
                  }
                }
                if (URL) {
                  (new ztoolkit.ProgressWindow("Launching URL", { closeOtherProgressWindows: true }))
                    .createLine({ text: URL, type: "default" })
                    .show()
                  Zotero.launchURL(URL);
                }
              } else {
                if (rows.querySelector("#reference-edit")) { return }
                if (editTimer) {
                  window.clearTimeout(editTimer)
                  Zotero.ProgressWindowSet.closeAll()
                  this.utils.copyText((idText ? idText + "\n" : "") + refText, false);
                  (new ztoolkit.ProgressWindow("Reference"))
                    .createLine({ text: refText, type: "success" })
                    .show()
                }
              }
            }
          },
        ],
        styles: {
          alignItems: "center",
          opacity: String(notInLibarayOpacity),
          paddingTop: "1px",
          paddingBottom: "1px"
        },
        children: [
          {
            tag: "img",
            attributes: {
              src: Zotero.ItemTypes.getImageSrc(reference.type as any) as string
            }
          },
          {
            tag: "label",
            id: "reference-label",
            properties: {
              innerText: refText
            },
            styles: {
              width: "100%"
            },
            listeners: [
              {
                type: "mousedown",
                listener: () => {
                  editTimer = window.setTimeout(() => {
                    editTimer = undefined
                    enterEdit()
                  }, 500);
                }
              }
            ]
          }
        ]
      }
    ) as XUL.Element
    const label = ztoolkit.UI.createElement(
      document, 
      "label",
      {
        id: "add-remove",
        namespace: "xul",
        attributes: {
          value: "+"
        },
        classList: [
          "zotero-clicky",
          "zotero-clicky-plus"
        ]
      }
    ) as XUL.Element;

    let enterEdit = () => {
      let label = box.querySelector("#reference-label")! as XUL.Label
      label.style.display = "none"
      let textarea = ztoolkit.UI.createElement(
        document,
        "textarea",
        {
          id: "reference-edit",
          namespace: "html",
          attributes: {
            flex: "1",
            multiline: "true",
            rows: "4"
          },
          properties: {
            value: addPrefix ? label.innerText.replace(/^\[\d+\]\s+/, "") : label.innerText,
          },
          styles: {
            width: "100%"
          },
          listeners: [
            {
              type: "blur",
              listener: async () => {
                await exitEdit()
              }
            }
          ]
        }
      ) as HTMLTextAreaElement
      textarea.focus()
      label.parentNode!.insertBefore(textarea, label)
      let exited = false;
      let id: any;
      let exitEdit = async () => {
        if (exited) return;
        exited = true;
        if (id) {
          window.clearInterval(id);
          id = undefined;
        }
        // 界面恢复
        let inputText = textarea.value?.trim();
        label.style.display = "";
        textarea.remove();
        // 保存结果
        if (!inputText || inputText === reference.text) { return; }
        label.innerText = `[${refIndex + 1}] ${inputText}`;
        references[refIndex] = {
          ...reference,
          ...{ identifiers: this.utils.getIdentifiers(inputText) },
          ...this.utils.refText2Info(inputText),
          ...{ text: inputText }
        };
        reference = references[refIndex];
        this.utils.searchLibraryItem(reference);
        const key = `References-${node.getAttribute("source")}`;
        window.setTimeout(async () => {
          await localStorage.set(item, key, references);
        });
      };

      id = window.setInterval(async () => {
        let active = rows.querySelector(".active");
        if (active && active !== box) {
          await exitEdit();
        }
      }, 100);
    }

    let setState = (state: string = "") => {
      switch (state) {
        case "+":
          label.setAttribute("class", "zotero-clicky zotero-clicky-plus");
          label.setAttribute("value", "+");
          label.style.opacity = "1";
          break;
        case "-":
          label.setAttribute("class", "zotero-clicky zotero-clicky-minus");
          label.setAttribute("value", "-");
          label.style.opacity = "1";
          break
        case "":
          label.setAttribute("value", "");
          label.style.opacity = ".23";
          break
      }
    }

    let remove = async () => {
      ztoolkit.log("removeRelatedItem");
      const popunWin = new ztoolkit.ProgressWindow("Removing Item", {closeTime: -1})
        .createLine({ text: refText, type: "default" })
        .show()
      setState()

      let relatedItem = this.utils.searchRelatedItem(item, reference._item) as Zotero.Item
      if (!relatedItem) {
        popunWin.changeHeadline("Removed");
        (node.querySelector("#refresh-button") as XUL.Button).click()
        popunWin.startCloseTimer(3000)
        return
      }
      relatedItem.removeRelatedItem(item)
      item.removeRelatedItem(relatedItem)
      await item.saveTx()
      await relatedItem.saveTx()
      setState("+")
      popunWin.changeLine({ type: "success" })
      popunWin.startCloseTimer(3000)
    }

    let add = async (collections: undefined | number[] = undefined) => {
      let collapseText = (text: string) => {
        let n
        if (this.utils.isChinese(text)) {
          n = 15
        } else {
          n = 35
        }
        return text.length > n ? (text.slice(0, n) + "...") : text
      }
      let popupWin = (new ztoolkit.ProgressWindow("Searching Item",
        { closeTime: -1, closeOtherProgressWindows: true}))
        .createLine({ text: collapseText(reference.text!), type: "default" })
        .show()
      // 检查本地
      let refItem = reference._item || await this.utils.searchLibraryItem(reference)
      // 禁用按钮
      setState()
      if (refItem) {
        popupWin.changeHeadline("Existing Item")
        popupWin.changeLine({ text: collapseText(refItem.getField("title"))})
      } else {
        let info: ItemBaseInfo = this.utils.refText2Info(reference.text!);
        // 知网
        if (this.utils.isChinese(reference.text!) && Zotero.Jasminum) {
          popupWin.changeHeadline("Creating Item")
          popupWin.changeLine({ text: collapseText(`CNKI: ${info.title}`) })
          try {
            refItem = await this.utils.createItemByJasminum(info.title!)
          } catch (e) { 
            ztoolkit.log(e)
          }
          if (!refItem) {
            popupWin.changeLine({ type: "fail" })
            popupWin.startCloseTimer(3000)
            setState("+")
            return
          }
        }
        // DOI or arXiv
        else {
          // DOI信息补全
          if (Object.keys(reference.identifiers).length == 0) {
            popupWin.changeHeadline("Searching DOI")
            popupWin.changeLine({ text: collapseText(`Title: ${info.title!}`) })
            let DOI = (await this.utils.API.getTitleInfoByConnectedpapers(info.title))?.identifiers?.DOI as string;
            if (!this.utils.isDOI(DOI)) {
              const resolved = await this.utils.API.resolveWork(info.title, info.authors?.[0], info.year);
              if (resolved?.doi) {
                DOI = resolved.doi;
              }
            }
            if (!this.utils.isDOI(DOI)) {
              setState("+");
              popupWin.changeLine({ type: "fail" })
              popupWin.startCloseTimer(3000)
              return
            }
            reference.identifiers = { DOI }
          }
          popupWin.changeHeadline("Creating Item")
          popupWin.changeLine({ text: collapseText(`${Object.keys(reference.identifiers)}: ${Object.values(reference.identifiers)[0]}`) })
          // done
          if (await this.utils.searchRelatedItem(item, refItem)) {
            popupWin.changeHeadline("Added Item")
            popupWin.changeLine({ type: "success" });
            popupWin.startCloseTimer(3000);
            (node.querySelector("#refresh-button") as XUL.Button).click();
            return
          }
          // search DOI in local or create via Translator with metadata fallback
          try {
            refItem = await this.utils.createItemByZotero(reference.identifiers, (collections || item.getCollections()), reference);
          } catch (e: any) {
            popupWin.changeLine({ type: "fail" })
            popupWin.startCloseTimer(3000)
            setState("+")
            ztoolkit.log(e)
            return
          }
        }
        for (let collectionID of (collections || item.getCollections())) {
          refItem.addToCollection(collectionID);
        }
      }
      popupWin.changeHeadline("Adding Item")
      popupWin.changeLine({ text: collapseText(refItem.getField("title")) })
      // addRelatedItem
      reference._item = refItem
      item.addRelatedItem(refItem)
      refItem.addRelatedItem(item)
      await item.saveTx()
      await refItem.saveTx()
      // button
      setState("-")
      popupWin.changeLine({ type: "success" })
      popupWin.startCloseTimer(3000)
      updateRowByItem(refItem)
    }

    let updateRowByItem = (refItem: Zotero.Item) => {
      box.style.opacity = "1";
      box.querySelector("img")?.setAttribute("src", refItem.getImageSrc())
      let alreadyRelated = this.utils.searchRelatedItem(item, refItem)
      if (alreadyRelated) {
        setState("-")
      }
    }

    let timer: undefined | number, tipUI: TipUI;
    if (notInLibarayOpacity < 1) {
      window.setTimeout(async () => {
        const refItem = reference._item || await this.utils.searchLibraryItem(reference) as Zotero.Item
        if (refItem) {
          updateRowByItem(refItem)
        }
      }, refIndex * 0)
    }
    // 鼠标进入浮窗展示
    box.addEventListener("mouseenter", () => {
      if (!Zotero.Prefs.get(`${config.addonRef}.isShowTip`)) { return }
      box.classList.add("active")
      let timeout = parseInt(Zotero.Prefs.get(`${config.addonRef}.showTipAfterMillisecond`) as string)
      const position = Zotero.Prefs.get("extensions.zotero.layout", true) == "stacked" ? "top center" : "left"
      timer = window.setTimeout(async () => {
        const winRect: Rect = document.documentElement.getBoundingClientRect()
        const rect = box.getBoundingClientRect()
        rect.x -= 5
        tipUI = this.showTipUI(rect, reference, position, idText)
        if (!box.classList.contains("active")) {
          tipUI.container.style.display = "none"
        }
      }, timeout);
    })

    box.addEventListener("mouseleave", () => {
      box.classList.remove("active")
      window.clearTimeout(timer);
      if (!tipUI) { return }
      const timeout = tipUI.removeTipAfterMillisecond
      tipUI.tipTimer = window.setTimeout(() => {
        if (!rows.querySelector(".active")) {
          tipUI && tipUI.clear()
        }
      }, timeout / 2);
    });

    (label as any).addEventListener("click", async (event: any) => {
      event.preventDefault()
      event.stopPropagation()
      const value = label.getAttribute("value")
      if (value == "+") {
        if (event.ctrlKey || event.metaKey) {
          let rect = box.getBoundingClientRect()
          // 构建分类选择
          let menuPopup = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", 'menupopup') as XUL.MenuPopup;
          menuPopup.addEventListener("popuphidden", () => menuPopup.remove(), { once: true });
          (document.querySelector("#browser") || document.documentElement)?.append(menuPopup);
          let collections = Zotero.Collections.getByLibrary(item?.libraryID || 1);
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
          await add()
        }
      } else if (value == "-") {
        await remove()
      }
    });

    (box as any)._cachedSearchText = refText.toLowerCase();

    if (appendToDOM) {
      rows.append(box, label);
      let referenceNum = rows.childNodes.length;
      if (addSearch && referenceNum && !node.querySelector(`#${config.addonRef}-search`)) { this.addSearch(node); }
      // 高度自适应与边界保护
      if (rows.getBoundingClientRect) {
        const top = rows.getBoundingClientRect().top;
        const totalH = document.documentElement?.getBoundingClientRect()?.height || window.innerHeight || 800;
        if (top > 0 && totalH > top) {
          rows.style.maxHeight = `${totalH - top}px`;
        }
      }
    }
    return { box, label };
  }

  public addSearch(node: HTMLDivElement) {
    const targetGrid = node.querySelector(".grid") || node.querySelector("#related-grid");
    if (!targetGrid) return;

    const iconSize = 14;
    let inputNode!: HTMLInputElement;
    let clearNode!: HTMLDivElement;
    let debounceTimer: number | undefined;
    const searchBox = ztoolkit.UI.insertElementBefore({
      tag: "div",
      id: `${config.addonRef}-search`,
      classList: ["reference-search-box"],
      styles: {
        height: "26px",
        boxSizing: "border-box",
        padding: "2px 8px",
        borderRadius: "4px",
        border: "1px solid var(--material-border, #e0e0e0)",
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        margin: "6px 8px",
        opacity: "0.85",
        background: "var(--material-background, #ffffff)"
      },
      children: [
        {
          tag: "div",
          styles: {
            width: `${iconSize}px`,
            height: `${iconSize}px`,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            flexShrink: "0"
          },
          properties: {
            innerHTML: `<svg viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" width="${iconSize}" height="${iconSize}"><path d="M1005.312 914.752l-198.528-198.464A448 448 0 1 0 0 448a448 448 0 0 0 716.288 358.784l198.4 198.4a64 64 0 1 0 90.624-90.432zM448 767.936A320 320 0 1 1 448 128a320 320 0 0 1 0 640z" fill="#888888"></path></svg>`
          }
        },
        {
          tag: "input",
          attributes: {
            placeholder: getString("relatedbox-search-placeholder") || "搜索参考文献 / Search References",
            type: "text"
          },
          styles: {
            outline: "none",
            border: "none",
            width: "100%",
            margin: "0 6px",
            fontSize: "12px",
            background: "transparent",
            color: "inherit"
          },
          listeners: [
            {
              type: "focus",
              listener: () => {
                searchBox.style.opacity = "1";
                searchBox.style.boxShadow = `0 0 0 1px var(--material-primary, rgba(0,0,0,0.4))`;
              }
            },
            {
              type: "blur",
              listener: () => {
                searchBox.style.opacity = "0.85";
                searchBox.style.boxShadow = ``;
              }
            },
            {
              type: "input",
              listener: () => {
                const keyword = (inputNode.value || "") as string;
                clearNode.style.display = keyword.length > 0 ? "flex" : "none";
                window.clearTimeout(debounceTimer);
                debounceTimer = window.setTimeout(() => {
                  const keywords = keyword.split(/[ ,，]/).map(k => k.trim().toLowerCase()).filter(Boolean);
                  const boxes = node.querySelectorAll("#related-grid .box");
                  const numLabel = node.querySelector("label#reference-num") as HTMLElement;
                  const curSource = node.getAttribute("source") || "PDF";

                  if (keywords.length === 0) {
                    boxes.forEach((box: any) => {
                      box.style.display = "";
                      if (box.nextElementSibling && box.nextElementSibling.id === "add-remove") {
                        (box.nextElementSibling as HTMLElement).style.display = "";
                      }
                    });
                    if (numLabel) {
                      numLabel.innerText = `${boxes.length} ${getString("relatedbox-number-label")} [${curSource}]`;
                    }
                    return;
                  }

                  let matchedCount = 0;
                  boxes.forEach((box: any) => {
                    const content: string = box._cachedSearchText || (box.querySelector("#reference-label") as any)?.textContent?.toLowerCase() || "";
                    let isAllMatched = true;
                    for (let i = 0; i < keywords.length; i++) {
                      if (content.indexOf(keywords[i]) === -1) {
                        isAllMatched = false;
                        break;
                      }
                    }
                    const displayVal = isAllMatched ? "" : "none";
                    box.style.display = displayVal;
                    if (box.nextElementSibling && box.nextElementSibling.id === "add-remove") {
                      (box.nextElementSibling as HTMLElement).style.display = displayVal;
                    }
                    if (isAllMatched) matchedCount++;
                  });

                  if (numLabel) {
                    numLabel.innerText = `${matchedCount}/${boxes.length} ${getString("relatedbox-number-label")} [${curSource}]`;
                  }
                }, 120);
              }
            }
          ]
        },
        {
          tag: "div",
          classList: ["icon", "clear"],
          styles: {
            width: `${iconSize}px`,
            height: `${iconSize}px`,
            display: "none",
            cursor: "pointer",
            justifyContent: "center",
            alignItems: "center",
            flexShrink: "0"
          },
          properties: {
            innerHTML: `<svg class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" width="${iconSize}" height="${iconSize}"><path d="M512.288 1009.984c-274.912 0-497.76-222.848-497.76-497.76s222.848-497.76 497.76-497.76c274.912 0 497.76 222.848 497.76 497.76s-222.848 497.76-497.76 497.76zM700.288 368.768c12.16-12.16 12.16-31.872 0-44s-31.872-12.16-44.032 0l-154.08 154.08-154.08-154.08c-12.16-12.16-31.872-12.16-44.032 0s-12.16 31.84 0 44l154.08 154.08-154.08 154.08c-12.16 12.16-12.16 31.84 0 44s31.872 12.16 44.032 0l154.08-154.08 154.08 154.08c12.16 12.16 31.872 12.16 44.032 0s12.16-31.872 0-44l-154.08-154.08 154.08-154.08z" fill="#888888"></path></svg>`
          },
          listeners: [
            {
              type: "click",
              listener: () => {
                window.clearTimeout(debounceTimer);
                inputNode.value = "";
                clearNode.style.display = "none";
                const boxes = node.querySelectorAll("#related-grid .box");
                boxes.forEach((box: any) => {
                  box.style.display = "";
                  if (box.nextElementSibling && box.nextElementSibling.id === "add-remove") {
                    (box.nextElementSibling as HTMLElement).style.display = "";
                  }
                });
                const numLabel = node.querySelector("label#reference-num") as HTMLElement;
                if (numLabel) {
                  const curSource = node.getAttribute("source") || "PDF";
                  numLabel.innerText = `${boxes.length} ${getString("relatedbox-number-label")} [${curSource}]`;
                }
              }
            }
          ]
        },
      ]
    }, targetGrid) as HTMLDivElement;
    inputNode = searchBox.querySelector("input") as HTMLInputElement;
    clearNode = searchBox.querySelector(".clear") as HTMLDivElement;
  }
}
