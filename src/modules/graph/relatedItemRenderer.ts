import { config } from "../../../package.json";
import { getString } from "../../utils/locale";
import { importFailureText, importErrorText } from "../importErrors";
import type TipUI from "../tip";
import type ConnectedPapers from "../connectedpapers";

export class RelatedItemRenderer {
  public static render(controller: ConnectedPapers, parent: HTMLDivElement, info: ItemInfo, color?: string): any {
    let tipUI: TipUI, timer: number | undefined;
    const originsAtRender = [...(controller as any).itemIDs];
    const win = (controller as any).win;
    const doc = (controller as any).doc;
    const views = (controller as any).views;

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
                      (controller as any).setNodeState({ state: "hover", paperID: info.identifiers.paperID as string });
                    }
                  },
                  {
                    type: "mouseleave",
                    listener: () => {
                      (controller as any).setNodeState({ state: "hover", paperID: "" });
                    }
                  },
                  {
                    type: "click",
                    listener: () => {
                      (controller as any).setNodeState({ state: "selected", paperID: info.identifiers.paperID as string });
                      new ztoolkit.Clipboard().addText(info.identifiers!.DOI!, "text/unicode").copy();
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
                      (controller as any).itemIDs = (controller as any).itemIDs.filter((i: number) => i != info._itemID);
                      itemNode.remove();
                      (controller as any).updateAddOrRemove();
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
                (controller as any).setNodeState({ state: "hover", paperID: info.identifiers.paperID as string });
              }
            },
            {
              type: "mouseup",
              listener: (event: any) => {
                if (event.button != 2) { return; }
                itemNode.classList.add("active");
                const rawTipTimeout = Zotero.Prefs.get(`${config.addonRef}.showTipAfterMillisecond`);
                let timeout = rawTipTimeout !== undefined ? parseInt(String(rawTipTimeout)) : 233;
                if (isNaN(timeout)) timeout = 233;
                const position = Zotero.Prefs.get("extensions.zotero.layout", true) == "stacked" ? "top center" : "left";
                timer = win.setTimeout(async () => {
                  const rect = itemNode.getBoundingClientRect() as any;
                  tipUI = views.showTipUI(rect, info, position, info.identifiers.DOI, false, win);
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
                win.clearTimeout(timer);
                if (!tipUI) { return; }
                const timeout = tipUI.removeTipAfterMillisecond;
                tipUI.tipTimer = win.setTimeout(async () => {
                  for (let i = 0; i < timeout / 2; i++) {
                    if ((controller as any).relatedContainer?.querySelector(".active")) { return; }
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
                (controller as any).setNodeState({ state: "selected", paperID: info.identifiers.paperID as string });
                new ztoolkit.Clipboard().addText(info.identifiers!.DOI!, "text/unicode").copy();
              }
            }
          ]
        },
      ],
    }, parent);

    const importAction: any = ztoolkit.UI.appendElement({
      tag: "button",
      attributes: { type: 'button', title: getString(info?._itemID ? 'cards-show-library' : 'cards-import'), 'aria-label': getString(info?._itemID ? 'cards-show-library' : 'cards-import') },
      styles: {
        width: "2em",
        height: "2em",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        cursor: "pointer",
        background: 'transparent', border: 'none', padding: '0', flexShrink: '0'
      },
      properties: {
        innerHTML: info?._itemID ?
          `<svg viewBox="0 0 743 743" width="1.2em" height="1.2em" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" overflow="hidden"><defs><clipPath id="clip0"><rect x="769" y="697" width="743" height="743"/></clipPath></defs><g transform="translate(-769 -697)"><path d="M769 1068.5C769 863.326 935.326 697 1140.5 697 1345.67 697 1512 863.326 1512 1068.5 1512 1273.67 1345.67 1440 1140.5 1440 935.326 1440 769 1273.67 769 1068.5Z" fill="#ca6363" fill-rule="evenodd"/><path d="M1162.25 901C1173.47 901 1181.89 904.166 1190.66 912.612L1316.22 1032.96C1327.09 1042.81 1332 1054.07 1332 1068.5 1332 1082.58 1326.74 1094.19 1316.22 1104.04L1190.66 1224.39C1181.89 1232.48 1173.47 1236 1162.25 1236 1141.2 1236 1126.12 1220.52 1126.12 1198.35 1126.12 1187.79 1130.68 1177.24 1138.75 1170.55L1178.73 1133.95 1215.56 1107.56 1143.66 1112.13 989.685 1112.13C965.838 1112.13 949 1093.13 949 1068.5 949 1043.52 965.838 1024.87 989.685 1024.87L1143.66 1024.87 1215.21 1029.09 1179.78 1003.05 1138.75 966.451C1130.68 959.766 1126.12 949.209 1126.12 938.3 1126.12 916.483 1141.2 901 1162.25 901Z" fill="#FFFFFF" fill-rule="evenodd"/></g></svg>`
          :
          `<svg viewBox="0 0 743 743" width="1.2em" height="1.2em" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" overflow="hidden"><defs><clipPath id="clip0"><rect x="944" y="711" width="743" height="743"/></clipPath></defs><g transform="translate(-944 -711)"><path d="M944 1082.5C944 877.326 1110.33 711 1315.5 711 1520.67 711 1687 877.326 1687 1082.5 1687 1287.67 1520.67 1454 1315.5 1454 1110.33 1454 944 1287.67 944 1082.5Z" fill="#9cb8b8" fill-rule="evenodd"/><path d="M1159.5 1083.5 1472.1 1083.5" stroke="#FFFFFF" stroke-width="87.0833" stroke-linecap="round" stroke-miterlimit="8" fill="none" fill-rule="evenodd"/><path d="M1316.5 927.5 1316.5 1240.1" stroke="#FFFFFF" stroke-width="87.0833" stroke-linecap="round" stroke-miterlimit="8" fill="none" fill-rule="evenodd"/></g></svg>`
      },
      listeners: [
        {
          type: "click",
          listener: async (event: any) => {
            event.stopPropagation();
            if ((controller as any).disposed || importAction.disabled || !itemNode.isConnected) return;
            if (info._itemID) {
              const existing = Zotero.Items.get(info._itemID as number);
              if (existing && !existing.deleted) await views.utils.selectItemInLibrary(existing, win);
            } else {
              if (originsAtRender.join(',') !== (controller as any).itemIDs.join(',')) return;
              const DOI = info.identifiers.DOI;
              const originItems = originsAtRender.map(id => Zotero.Items.get(id)).filter((item): item is Zotero.Item => Boolean(item));

              const add = async (collections: number[]) => {
                if ((controller as any).disposed || importAction.disabled || !itemNode.isConnected || originsAtRender.join(',') !== (controller as any).itemIDs.join(',')) return;
                importAction.disabled = true;
                importAction.setAttribute('aria-busy', 'true');
                importAction.title = getString('cards-importing-doi');
                const popupWin = new ztoolkit.ProgressWindow(getString('cards-importing-doi'), { closeTime: -1 })
                  .createLine({ text: DOI, type: "default" })
                  .show();
                try {
                  if (!originItems.length || originItems.length !== originsAtRender.length || originItems.some(item => item.deleted)) throw new Error(getString('graph-origins-changed'));
                  const result = await views.importReferences(originItems[0], [info], {
                    owner: controller, collections, relatedParents: originItems.slice(1), downloadOA: false,
                    createSubCollection: false, createManifestNote: false
                  });
                  if (result.cancelled) throw new Error(getString('cards-import-cancelled'));
                  if (result.failedCount) throw new Error(importFailureText(result.failures[0]));
                  if (info._item) info._itemID = info._item.id;
                  popupWin.changeHeadline(getString('cards-import-complete'));
                  popupWin.changeLine({ type: "success" });
                  if (!(controller as any).disposed && itemNode.isConnected && originsAtRender.join(',') === (controller as any).itemIDs.join(',')) {
                    (doc.querySelector("#build-graph") as HTMLDivElement)?.click();
                  }
                } catch (error) {
                  popupWin.changeLine({ text: importErrorText(error), type: "fail" });
                  ztoolkit.log(error);
                }
                finally {
                  popupWin.startCloseTimer(3000);
                  importAction.disabled = false;
                  importAction.removeAttribute('aria-busy');
                  importAction.title = getString(info._itemID ? 'cards-show-library' : 'cards-import');
                  importAction.setAttribute('aria-label', importAction.title);
                }
              };

              const collections: number[] = originItems[0] ? views.utils.importCollections(originItems[0], win) : [];
              if (event.ctrlKey || event.metaKey) {
                const rect = itemNode.getBoundingClientRect();
                const menuPopup = doc.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", 'menupopup') as XUL.MenuPopup;
                doc.querySelector("#browser")!.append(menuPopup);
                const libId = originItems[0]?.libraryID || 1;
                const allCollections = Zotero.Collections.getByLibrary(libId);
                for (const col of allCollections) {
                  const menuItem = Zotero.Utilities.Internal.createMenuForTarget(
                    col,
                    menuPopup,
                    null as any,
                    async (ev: any, collection: any) => {
                      if (ev.target.tagName == 'menuitem') {
                        ztoolkit.log(collection);
                        menuPopup.remove();
                        await add([collection.id]);
                        ev.stopPropagation();
                      }
                    }
                  );
                  menuPopup.append(menuItem);
                }
                // @ts-ignore
                menuPopup.openPopupAtScreen(rect.left, rect.top + rect.height, true);
              } else {
                await add(collections);
              }
            }
          }
        }
      ]
    }, itemNode);

    return itemNode;
  }
}
