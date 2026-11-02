import { config } from "../../../package.json";
import { graphColor } from "../graphModel";
import type ConnectedPapers from "../connectedpapers";

export class RelatedPanelBuilder {
  public static build(controller: ConnectedPapers, box: XUL.Box): HTMLDivElement {
    const relatedContainer = ztoolkit.UI.appendElement({
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
                    innerHTML: `<svg style="margin-right: .5em;" width="24" height="24" viewBox="2 0 24 24" fill="#7a306c" xmlns="http://www.w3.org/2000/svg" class="graph-action-icon mr-[6px]" data-v-f4c185ee=""><path d="M11 19V13H5V11H11V5H13V11H19V13H13V19H11Z"></path></svg>`
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
                    const win = (controller as any).win;
                    const items = win.ZoteroPane.getSelectedItems();
                    if (!items || items.length === 0 || !items[0]) {
                      return;
                    }
                    const item = items[0];
                    const itemTitle = (item.getField("title") as string) || "Item";
                    const popupWin = new ztoolkit.ProgressWindow("Add Origin", { closeTime: -1 })
                      .createLine({ text: itemTitle, type: "connectedpapers" })
                      .show();
                    const info: ItemInfo = {
                      identifiers: { DOI: (item.getField("DOI") as string) || "", paperID: await (controller as any).getPaperID(item) },
                      authors: item.getCreators().map((i: any) => i.name || [i.firstName, i.lastName].filter(Boolean).join(" ")),
                      tags: item.getTags().map((i: any) => {
                        // @ts-ignore
                        const ctag: any = item.getColoredTags().find((ci: any) => ci.tag == i.tag);
                        if (ctag) {
                          return { text: i.tag, color: ctag.color };
                        } else {
                          return i.tag;
                        }
                      }),
                      abstract: item.getField("abstractNote") as string,
                      title: itemTitle,
                      year: ((item.getField("date") as string) || "").match(/\b(19\d\d|20\d\d)\b/)?.[0] || undefined,
                      primaryVenue: item.getField("publicationTitle") as string,
                      type: "",
                      source: "Zotero",
                      _itemID: item.id
                    };

                    controller.addItem(
                      relatedContainer.querySelector("#origin-items-container .origin-items")!,
                      info,
                    );
                    if ((controller as any).disposed || !relatedContainer.isConnected || (controller as any).itemIDs.includes(item.id)) return;
                    (controller as any).itemIDs.push(item.id);
                    (controller as any).invalidateGraph();
                    (controller as any).updateAddOrRemove();
                    popupWin.changeLine({ text: itemTitle, type: "success" })
                      .startCloseTimer(1000);
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
                    innerHTML: `<svg style="margin-right: .5em;" width="24" height="24" viewBox="0 0 24 24" fill="#7a306c" xmlns="http://www.w3.org/2000/svg" class="graph-action-icon mr-[6px]" data-v-f4c185ee=""><path d="M19 13H5V11H19V13Z"></path></svg>`
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
                    const win = (controller as any).win;
                    const items = win.ZoteroPane.getSelectedItems();
                    if (!items || items.length === 0 || !items[0]) return;
                    const itemID = items[0].id;
                    (controller as any).itemIDs = (controller as any).itemIDs.filter((i: number) => i != itemID);
                    (controller as any).invalidateGraph();
                    relatedContainer.querySelectorAll(".normal-items .item")?.forEach(e => e.remove());
                    relatedContainer.querySelectorAll("#origin-items-container .origin-items .item")
                      .forEach(e => {
                        if (Number(e.getAttribute("zotero-item-id")) == itemID) {
                          e.remove();
                        }
                      });
                    (controller as any).updateAddOrRemove();
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
                const itemIDs = (controller as any).itemIDs as number[];
                if (itemIDs.length === 0) {
                  new ztoolkit.ProgressWindow("Connected Papers")
                    .createLine({ text: "Please select a Zotero Item and click Add Origin first, then click Build Graph.", type: "connectedpapers" })
                    .show();
                  return;
                }
                const items = itemIDs.map((id: number) => Zotero.Items.get(id)) as Zotero.Item[];
                const graphdata = await (controller as any).refresh(items);
                if (!graphdata || !relatedContainer.isConnected || (controller as any).disposed) return;
                relatedContainer.querySelectorAll(".normal-items .item, .prior-items .item, .deriv-items .item").forEach(e => e.remove());
                ztoolkit.log("graphdata", graphdata);

                Object.values(graphdata.nodes).sort((a: any, b: any) => b.year - a.year).forEach((paper: any) => {
                  controller.addItem(
                    relatedContainer.querySelector(".normal-items") as HTMLDivElement,
                    (controller as any).paper2Info(paper),
                    graphColor(paper),
                  );
                });

                graphdata.common_references.sort((a: any, b: any) => b.year - a.year).forEach((paper: any) => {
                  const itemNode = controller.addItem(
                    relatedContainer.querySelector(".prior-items") as HTMLDivElement,
                    (controller as any).paper2Info(paper),
                    graphColor(paper)
                  );
                  itemNode.setAttribute("local", paper.local_citations.join("+"));
                });

                graphdata.common_citations.sort((a: any, b: any) => b.year - a.year).forEach((paper: any) => {
                  const itemNode = controller.addItem(
                    relatedContainer.querySelector(".deriv-items") as HTMLDivElement,
                    (controller as any).paper2Info(paper),
                    graphColor(paper)
                  );
                  itemNode.setAttribute("local", paper.local_references.join("+"));
                });
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
                    const container = (controller as any).relatedContainer;
                    const w1 = container?.querySelector("#prior-works");
                    const w2 = container?.querySelector("#deriv-works");
                    const i1 = container?.querySelector(".prior-items") as HTMLDivElement;
                    const i2 = container?.querySelector(".deriv-items") as HTMLDivElement;
                    const i0 = container?.querySelector(".normal-items") as HTMLDivElement;
                    if (!i0 || !i1 || !i2 || !w1 || !w2) return;
                    w2.classList.remove("activate");
                    i2.style.display = "none";
                    i0.style.borderLeft = i0.style.borderRight = i1.style.borderLeft = i1.style.borderRight = "none";
                    if (w1.classList.contains("activate")) {
                      w1.classList.remove("activate");
                      i1.style.display = "none";
                      i1.style.borderLeft = "none";
                      i0.style.borderRight = "none";
                      i0.style.width = "100%";
                    } else {
                      w1.classList.add("activate");
                      i1.style.display = "";
                      i0.style.width = i1.style.width = "50%";
                      i0.style.borderLeft = ".5px solid #cecece";
                      i1.style.borderRight = ".5px solid #cecece";
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
                    const container = (controller as any).relatedContainer;
                    const w2 = container?.querySelector("#prior-works");
                    const w1 = container?.querySelector("#deriv-works");
                    const i2 = container?.querySelector(".prior-items") as HTMLDivElement;
                    const i1 = container?.querySelector(".deriv-items") as HTMLDivElement;
                    const i0 = container?.querySelector(".normal-items") as HTMLDivElement;
                    if (!i0 || !i1 || !i2 || !w1 || !w2) return;
                    w2.classList.remove("activate");
                    i2.style.display = "none";
                    i0.style.borderLeft = i0.style.borderRight = i1.style.borderLeft = i1.style.borderRight = "none";
                    if (w1.classList.contains("activate")) {
                      w1.classList.remove("activate");
                      i1.style.display = "none";
                      i0.style.width = "100%";
                    } else {
                      w1.classList.add("activate");
                      i1.style.display = "";
                      i0.style.width = i1.style.width = "50%";
                      i0.style.borderRight = ".5px solid #cecece";
                      i1.style.borderLeft = ".5px solid #cecece";
                    }
                  }
                }
              ]
            }
          ]
        }
      ]
    }, box) as HTMLDivElement;

    (controller as any).relatedContainer = relatedContainer;
    for (const node of Array.from(relatedContainer.querySelectorAll('#add-origin,#remove-origin,#build-graph,#prior-works,#deriv-works')) as HTMLElement[]) {
      node.setAttribute('role', 'button');
      node.tabIndex = 0;
      node.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          node.click();
        }
      });
    }
    return relatedContainer;
  }
}
