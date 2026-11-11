import { config } from "../../package.json";
import Views from "./views";
import { getString } from "../utils/locale";
import { handleGraphCardImport } from "./graphCardImport";
import {
  GRAPH_ICON_REMOVE_CARD,
  GRAPH_ICON_OPEN_LIBRARY,
  GRAPH_ICON_ADD_LIBRARY
} from "./graphIcons";

export interface GraphCardContext {
  views: Views;
  win: Window;
  doc: Document;
  getItemIDs: () => number[];
  setItemIDs: (ids: number[]) => void;
  updateAddOrRemove: () => void;
  setNodeState: (arg: { state: "selected" | "hover"; paperID: string }) => void;
  isDisposed: () => boolean;
  getRelatedContainer: () => HTMLElement | undefined;
}

/**
 * Renders an individual graph node reference item card with interaction handlers.
 */
export function renderGraphCard(
  parent: HTMLElement,
  info: ItemInfo,
  color: string | undefined,
  ctx: GraphCardContext
): HTMLElement {
  let tipUI: any, timer: number | undefined;
  const originsAtRender = [...ctx.getItemIDs()];

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
            ? {
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
                      ctx.setNodeState({ state: "hover", paperID: info.identifiers?.paperID as string });
                    }
                  },
                  {
                    type: "mouseleave",
                    listener: () => {
                      ctx.setNodeState({ state: "hover", paperID: "" });
                    }
                  },
                  {
                    type: "click",
                    listener: () => {
                      ctx.setNodeState({ state: "selected", paperID: info.identifiers?.paperID as string });
                      if (info.identifiers?.DOI) {
                        new ztoolkit.Clipboard().addText(info.identifiers.DOI, "text/unicode").copy();
                      }
                    }
                  }
                ]
              }
            : {
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
                  innerHTML: GRAPH_ICON_REMOVE_CARD
                },
                listeners: [
                  {
                    type: "click",
                    listener: () => {
                      ctx.setItemIDs(ctx.getItemIDs().filter((i) => i !== info._itemID));
                      itemNode.remove();
                      ctx.updateAddOrRemove();
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
              ctx.setNodeState({ state: "hover", paperID: info.identifiers?.paperID as string });
            }
          },
          {
            type: "mouseup",
            listener: (event: any) => {
              if (event.button !== 2) return;
              itemNode.classList.add("active");
              const rawTipTimeout = Zotero.Prefs.get(`${config.addonRef}.showTipAfterMillisecond`);
              let timeout = rawTipTimeout !== undefined ? parseInt(String(rawTipTimeout)) : 233;
              if (isNaN(timeout)) timeout = 233;
              const position = Zotero.Prefs.get("extensions.zotero.layout", true) === "stacked" ? "top center" : "left";
              timer = ctx.win.setTimeout(async () => {
                const rect = itemNode.getBoundingClientRect() as any;
                tipUI = ctx.views.showTipUI(rect, info, position, info.identifiers?.DOI, false, ctx.win);
                if (!itemNode.classList.contains("active")) {
                  tipUI.container.style.display = "none";
                }
              }, timeout);
            }
          },
          {
            type: "mouseleave",
            listener: () => {
              itemNode.classList.remove("active");
              ctx.win.clearTimeout(timer);
              if (!tipUI) return;
              const timeout = tipUI.removeTipAfterMillisecond;
              tipUI.tipTimer = ctx.win.setTimeout(async () => {
                for (let i = 0; i < timeout / 2; i++) {
                  if (ctx.getRelatedContainer()?.querySelector(".active")) return;
                  await Zotero.Promise.delay(1 / 1000);
                }
                tipUI && tipUI.clear();
              }, timeout / 2);
            }
          },
          {
            type: "click",
            listener: () => {
              tipUI && tipUI.clear();
              ctx.setNodeState({ state: "selected", paperID: info.identifiers?.paperID as string });
              if (info.identifiers?.DOI) {
                new ztoolkit.Clipboard().addText(info.identifiers.DOI, "text/unicode").copy();
              }
            }
          }
        ]
      },
    ],
  }, parent);

  const originsEditable = originsAtRender.length === 0 || originsAtRender.every((id) => {
    const origin = Zotero.Items.get(id);
    return Boolean(
      origin &&
      !origin.deleted &&
      (typeof origin.isEditable !== "function" || origin.isEditable()) &&
      (Zotero as any).Libraries?.get?.(origin.libraryID)?.editable !== false
    );
  });

  const importActionLabel = getString(
    info?._itemID ? "cards-show-library" : (originsEditable ? "cards-import" : "cards-library-readonly")
  );

  const importAction: any = ztoolkit.UI.appendElement({
    tag: "button",
    attributes: {
      type: "button",
      title: importActionLabel,
      "aria-label": importActionLabel,
      ...(!info?._itemID && !originsEditable ? { disabled: "true" } : {})
    },
    styles: {
      width: "2em",
      height: "2em",
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      cursor: "pointer",
      background: "transparent",
      border: "none",
      padding: "0",
      flexShrink: "0"
    },
    properties: {
      innerHTML: info?._itemID ? GRAPH_ICON_OPEN_LIBRARY : GRAPH_ICON_ADD_LIBRARY
    },
    listeners: [
      {
        type: "click",
        listener: async (event: any) => {
          event.stopPropagation();
          await handleGraphCardImport(info, originsAtRender, itemNode, importAction, ctx, event);
        }
      }
    ]
  }, itemNode);

  return itemNode;
}
