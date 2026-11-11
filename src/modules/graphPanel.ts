import { config } from "../../package.json";
import Views from "./views";
import { graphColor } from "./graphModel";
import { getString } from "../utils/locale";
import {
  GRAPH_ICON_ADD_ORIGIN,
  GRAPH_ICON_REMOVE_ORIGIN,
  GRAPH_ICON_BUILD
} from "./graphIcons";

export interface GraphPanelContext {
  doc: Document;
  win: any;
  views: Views;
  frame?: HTMLIFrameElement;
  getItemIDs: () => number[];
  setItemIDs: (ids: number[]) => void;
  getPaperID: (item: Zotero.Item) => Promise<string | undefined>;
  addItem: (parent: HTMLElement, info: ItemInfo, color?: string) => any;
  refresh: (items: Zotero.Item[]) => Promise<{ graphData: Graph; partialOrigins: number; source: string } | undefined>;
  paper2Info: (paper: any) => ItemInfo;
  updateAddOrRemove: () => void;
  invalidateGraph: () => void;
  isDisposed: () => boolean;
}

/**
 * Builds the related papers side panel including origin controls, build graph trigger,
 * and prior/derivative work toggles.
 */
export function buildGraphRelatedPanel(box: XUL.Box, ctx: GraphPanelContext): HTMLDivElement {
  const toggleSplitPane = (activeId: string, inactiveId: string, activeSelector: string, inactiveSelector: string, isLeft: boolean) => {
    const activeBtn = relatedContainer.querySelector(activeId)!;
    const inactiveBtn = relatedContainer.querySelector(inactiveId)!;
    const activeList = relatedContainer.querySelector(activeSelector) as HTMLDivElement;
    const inactiveList = relatedContainer.querySelector(inactiveSelector) as HTMLDivElement;
    const normalList = relatedContainer.querySelector(".normal-items") as HTMLDivElement;
    inactiveBtn.classList.remove("activate");
    inactiveList.style.display = "none";
    normalList.style.borderLeft = normalList.style.borderRight = activeList.style.borderLeft = activeList.style.borderRight = "none";
    if (activeBtn?.classList.contains("activate")) {
      activeBtn.classList.remove("activate");
      activeList.style.display = "none";
      normalList.style.width = "100%";
    } else {
      activeBtn.classList.add("activate");
      activeList.style.display = "";
      normalList.style.width = activeList.style.width = "50%";
      const borderStyle = ".5px solid var(--material-border, #cecece)";
      if (isLeft) {
        normalList.style.borderLeft = borderStyle;
        activeList.style.borderRight = borderStyle;
      } else {
        normalList.style.borderRight = borderStyle;
        activeList.style.borderLeft = borderStyle;
      }
    }
  };

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
      height: "100%",
      color: "inherit"
    },
    children: [
      {
        tag: "div",
        id: "origin-items-container",
        styles: { display: "flex", flexDirection: "column" },
        children: [
          {
            tag: "div",
            styles: {
              maxHeight: "8em",
              overflow: "auto",
              borderTop: "1px solid var(--material-border, #cecece)",
            },
            classList: ["origin-items"]
          },
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
                properties: { innerHTML: GRAPH_ICON_ADD_ORIGIN }
              },
              {
                tag: "span",
                styles: { lineHeight: "2em" },
                properties: { innerText: getString("graph-add-origin") || "Add Origin" }
              }
            ],
            listeners: [
              {
                type: "click",
                listener: async () => {
                  const items = ctx.win.ZoteroPane.getSelectedItems();
                  if (!items || items.length === 0 || !items[0]) return;
                  const item = items[0];
                  const itemTitle = (item.getField("title") as string) || "Item";
                  const popupWin = new ztoolkit.ProgressWindow(getString("graph-add-origin") || "Add Origin", { closeTime: -1 })
                    .createLine({ text: itemTitle, type: "connectedpapers" })
                    .show();
                  const info: ItemInfo = {
                    identifiers: { DOI: (item.getField("DOI") as string) || "", paperID: await ctx.getPaperID(item) },
                    authors: item.getCreators().map((i: any) => i.name || [i.firstName, i.lastName].filter(Boolean).join(" ")),
                    tags: item.getTags().map((i: any) => {
                      const ctag: any = item.getColoredTags?.()?.find((ci: any) => ci.tag === i.tag);
                      return ctag ? { text: i.tag, color: ctag.color } : i.tag;
                    }),
                    abstract: item.getField("abstractNote") as string,
                    title: itemTitle,
                    year: ((item.getField("date") as string) || "").match(/\b(19\d\d|20\d\d)\b/)?.[0] || undefined,
                    primaryVenue: item.getField("publicationTitle") as string,
                    type: "",
                    source: "Zotero",
                    _itemID: item.id
                  };

                  ctx.addItem(relatedContainer.querySelector("#origin-items-container .origin-items")!, info);
                  const itemIDs = ctx.getItemIDs();
                  if (ctx.isDisposed() || !relatedContainer.isConnected || itemIDs.includes(item.id)) return;
                  ctx.setItemIDs([...itemIDs, item.id]);
                  ctx.invalidateGraph();
                  ctx.updateAddOrRemove();
                  popupWin.changeLine({ text: itemTitle, type: "success" }).startCloseTimer(1000);
                }
              }
            ]
          },
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
              backgroundColor: "var(--material-background, transparent)",
            },
            children: [
              {
                tag: "div",
                classList: ["icon"],
                properties: { innerHTML: GRAPH_ICON_REMOVE_ORIGIN }
              },
              {
                tag: "span",
                styles: { lineHeight: "2em" },
                properties: { innerText: getString("graph-remove-origin") || "Remove Origin" }
              }
            ],
            listeners: [
              {
                type: "click",
                listener: () => {
                  const items = ctx.win.ZoteroPane.getSelectedItems();
                  if (!items || items.length === 0 || !items[0]) return;
                  const itemID = items[0].id;
                  ctx.setItemIDs(ctx.getItemIDs().filter((i) => i !== itemID));
                  ctx.invalidateGraph();
                  relatedContainer.querySelectorAll(".normal-items .item")?.forEach((e) => e.remove());
                  relatedContainer.querySelectorAll("#origin-items-container .origin-items .item").forEach((e) => {
                    if (Number(e.getAttribute("zotero-item-id")) === itemID) e.remove();
                  });
                  ctx.updateAddOrRemove();
                }
              }
            ]
          }
        ]
      },
      {
        tag: "div",
        id: "build-graph",
        classList: ["button"],
        styles: {
          width: "100%",
          borderTop: "1px solid var(--material-border, #eee)",
          borderBottom: "1px solid var(--material-border, #eee)",
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
            styles: { display: "flex", justifyContent: "center", alignContent: "center" },
            properties: { innerHTML: GRAPH_ICON_BUILD }
          },
          {
            tag: "span",
            styles: { lineHeight: "2em" },
            properties: { innerText: getString("graph-build-graph") || "Build Graph" }
          }
        ],
        listeners: [
          {
            type: "click",
            listener: async () => {
              const itemIDs = ctx.getItemIDs();
              if (itemIDs.length === 0) {
                new ztoolkit.ProgressWindow("Connected Papers")
                  .createLine({ text: getString("graph-select-origin-prompt") || "Please select a Zotero Item and click Add Origin first, then click Build Graph.", type: "connectedpapers" })
                  .show();
                return;
              }
              const items = itemIDs.map((id: number) => Zotero.Items.get(id)) as Zotero.Item[];
              const result = await ctx.refresh(items);
              if (!result || !relatedContainer.isConnected || ctx.isDisposed()) return;
              const graphdata = result.graphData;
              relatedContainer.querySelectorAll(".normal-items .item, .prior-items .item, .deriv-items .item").forEach((e) => e.remove());
              ztoolkit.log("graphdata", graphdata);

              Object.values(graphdata.nodes).sort((a: any, b: any) => b.year - a.year).forEach((paper: any) => {
                ctx.addItem(
                  relatedContainer.querySelector(".normal-items") as HTMLDivElement,
                  ctx.paper2Info(paper),
                  graphColor(paper)
                );
              });

              graphdata.common_references.sort((a: any, b: any) => b.year - a.year).forEach((paper: any) => {
                const itemNode = ctx.addItem(
                  relatedContainer.querySelector(".prior-items") as HTMLDivElement,
                  ctx.paper2Info(paper),
                  graphColor(paper)
                );
                itemNode.setAttribute("local", paper.local_citations.join("+"));
              });

              graphdata.common_citations.sort((a: any, b: any) => b.year - a.year).forEach((paper: any) => {
                const itemNode = ctx.addItem(
                  relatedContainer.querySelector(".deriv-items") as HTMLDivElement,
                  ctx.paper2Info(paper),
                  graphColor(paper)
                );
                itemNode.setAttribute("local", paper.local_references.join("+"));
              });
            }
          }
        ]
      },
      {
        tag: "div",
        styles: { flexGrow: "1", overflowY: "auto", display: "flex", flexDirection: "row" },
        classList: ["items-container"],
        children: [
          { tag: "div", classList: ["prior-items"], styles: { display: "none", overflowY: "auto" } },
          { tag: "div", classList: ["normal-items"], styles: { overflowY: "auto" } },
          { tag: "div", classList: ["deriv-items"], styles: { display: "none", overflowY: "auto" } }
        ]
      },
      {
        tag: "div",
        styles: { display: "flex" },
        children: [
          {
            tag: "div",
            id: "prior-works",
            classList: ["filter-button"],
            properties: { innerText: getString("graph-prior-works") || "Prior Works" },
            listeners: [{ type: "click", listener: () => toggleSplitPane("#prior-works", "#deriv-works", ".prior-items", ".deriv-items", true) }]
          },
          {
            tag: "div",
            id: "deriv-works",
            classList: ["filter-button"],
            attributes: { activate: "false" },
            properties: { innerText: getString("graph-derivative-works") || "Derivative Works" },
            listeners: [{ type: "click", listener: () => toggleSplitPane("#deriv-works", "#prior-works", ".deriv-items", ".prior-items", false) }]
          }
        ]
      }
    ]
  }, box) as HTMLDivElement;

  for (const node of Array.from(relatedContainer.querySelectorAll("#add-origin,#remove-origin,#build-graph,#prior-works,#deriv-works")) as HTMLElement[]) {
    node.setAttribute("role", "button");
    node.tabIndex = 0;
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        node.click();
      }
    });
  }

  return relatedContainer;
}
