import { getString } from "../utils/locale";
import { importErrorText, importFailureText } from "./importErrors";
import type { GraphCardContext } from "./graphCard";

/**
 * Handles reference import and collection picker for graph node cards.
 */
export async function handleGraphCardImport(
  info: ItemInfo,
  originsAtRender: number[],
  itemNode: HTMLElement,
  importAction: any,
  ctx: GraphCardContext,
  event: MouseEvent
): Promise<void> {
  if (ctx.isDisposed() || importAction.disabled || !itemNode.isConnected) return;
  if (info._itemID) {
    const existing = Zotero.Items.get(info._itemID as number);
    if (existing && !existing.deleted) {
      await ctx.views.utils.selectItemInLibrary(existing, ctx.win);
    }
    return;
  }

  if (originsAtRender.join(",") !== ctx.getItemIDs().join(",")) return;
  const DOI = info.identifiers?.DOI || "";
  const originItems = originsAtRender
    .map((id) => Zotero.Items.get(id))
    .filter((item): item is Zotero.Item => Boolean(item));

  const add = async (collections: number[]) => {
    if (
      ctx.isDisposed() ||
      importAction.disabled ||
      !itemNode.isConnected ||
      originsAtRender.join(",") !== ctx.getItemIDs().join(",")
    ) {
      return;
    }
    importAction.disabled = true;
    importAction.setAttribute("aria-busy", "true");
    importAction.title = getString("cards-importing-doi");
    const popupWin = new ztoolkit.ProgressWindow(getString("cards-importing-doi"), { closeTime: -1 })
      .createLine({ text: DOI, type: "default" })
      .show();
    try {
      if (!originItems.length || originItems.length !== originsAtRender.length || originItems.some((item) => item.deleted)) {
        throw new Error(getString("graph-origins-changed"));
      }
      const result = await ctx.views.importReferences(originItems[0], [info], {
        owner: ctx.views,
        collections,
        relatedParents: originItems.slice(1),
        downloadOA: false,
        createSubCollection: false,
        createManifestNote: false,
      });
      if (result.cancelled) throw new Error(getString("cards-import-cancelled"));
      if (result.failedCount) throw new Error(importFailureText(result.failures[0]));
      if (info._item) info._itemID = info._item.id;
      popupWin.changeHeadline(getString("cards-import-complete"));
      popupWin.changeLine({ type: "success" });
      if (!ctx.isDisposed() && itemNode.isConnected && originsAtRender.join(",") === ctx.getItemIDs().join(",")) {
        (ctx.doc.querySelector("#build-graph") as HTMLDivElement)?.click();
      }
    } catch (error) {
      popupWin.changeLine({ text: importErrorText(error), type: "fail" });
      ztoolkit.log(error);
    } finally {
      popupWin.startCloseTimer(3000);
      importAction.disabled = false;
      importAction.removeAttribute("aria-busy");
      importAction.title = getString(info._itemID ? "cards-show-library" : "cards-import");
      importAction.setAttribute("aria-label", importAction.title);
    }
  };

  const collections: number[] = originItems[0]
    ? ctx.views.utils.importCollections(originItems[0], ctx.win)
    : [];

  if (event.ctrlKey || event.metaKey) {
    const rect = itemNode.getBoundingClientRect();
    const menuPopup = ctx.doc.createElementNS(
      "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
      "menupopup"
    ) as XUL.MenuPopup;
    ctx.doc.querySelector("#browser")!.append(menuPopup);
    const libId = originItems[0]?.libraryID || 1;
    const cols = Zotero.Collections.getByLibrary(libId);
    for (const col of cols) {
      const menuItem = Zotero.Utilities.Internal.createMenuForTarget(
        col,
        menuPopup,
        null as any,
        async (ev: any, collection: any) => {
          if (ev.target.tagName === "menuitem") {
            ztoolkit.log(collection);
            menuPopup.remove();
            await add([collection.id]);
            ev.stopPropagation();
          }
        }
      );
      menuPopup.append(menuItem);
    }
    (menuPopup as any).openPopupAtScreen(rect.left, rect.top + rect.height, true);
  } else {
    await add(collections);
  }
}
