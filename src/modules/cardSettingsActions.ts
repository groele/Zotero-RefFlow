import { config } from "../../package.json";
import { getString } from "../utils/locale";
import type Views from "./views";
import BatchImporter from "./batchImporter";
import type BatchResults from "./batchResults";
import { importFailureText, importSummaryText } from "./importErrors";

export interface CardSettingsActionContext {
  disposed: boolean;
  body: HTMLElement;
  parent: Zotero.Item | undefined;
  refs: ItemBaseInfo[];
  subset: ItemBaseInfo[];
  selectedCount: number;
  views: Views;
  batchResults: BatchResults;
  invalidateLibraryMatches: () => void;
  label: () => HTMLElement;
  open: (ref: ItemBaseInfo) => void;
}

/**
 * Executes a configured RefFlow quick action from preferences or menu.
 */
export async function executeCardSettingsAction(
  action: string,
  ctx: CardSettingsActionContext
): Promise<string> {
  if (ctx.disposed || !ctx.body.isConnected) throw new Error(getString("cards-settings-no-context"));
  const parent = ctx.parent;
  const all = [...ctx.refs];
  const refs = ctx.subset;

  if (action === "import-selected" && !ctx.selectedCount) throw new Error(getString("cards-select-before-import"));
  if (!parent || (action !== "rollback" && !(action === "import-all" ? all.length : refs.length))) {
    throw new Error(getString("cards-settings-no-context"));
  }
  if ((action === "import-selected" || action === "import-all" || action === "rollback") && parent && typeof parent.isEditable === "function" && !parent.isEditable()) {
    throw new Error(getString("cards-library-readonly"));
  }

  const same = () => !ctx.disposed && ctx.body.isConnected && Number(ctx.body.getAttribute("data-refflow-item-id")) === parent.id;

  if (action === "copy-text") {
    ctx.views.utils.copyText(refs.map((ref) => ref.text || ref.title).join("\n"), false);
  } else if (action === "copy-doi") {
    const values = refs.map((ref) => ref.identifiers?.DOI).filter(Boolean);
    if (!values.length) throw new Error(getString("cards-settings-no-doi"));
    ctx.views.utils.copyText(values.join("\n"), false);
  } else if (action === "copy-url") {
    const values = refs.map((ref) => ref.url || (ref.identifiers?.DOI ? `https://doi.org/${ref.identifiers.DOI}` : "")).filter(Boolean);
    if (!values.length) throw new Error(getString("cards-settings-no-url"));
    ctx.views.utils.copyText(values.join("\n"), false);
  } else if (action === "open") {
    const available = refs.filter((ref) => Boolean(ref._item) || /^https?:\/\//i.test(ref.url || (ref.identifiers?.DOI ? `https://doi.org/${ref.identifiers.DOI}` : "")));
    if (!available.length) throw new Error(getString("cards-settings-no-open"));
    available.slice(0, 20).forEach((ref) => ctx.open(ref));
    return getString("cards-settings-opened", { args: { count: Math.min(20, available.length), total: available.length } });
  } else if (action === "import-selected" || action === "import-all") {
    const chosen = action === "import-all" ? all : refs;
    if (!(Zotero as any).Libraries.get(parent.libraryID)?.editable) throw new Error(getString("cards-library-readonly"));
    const collections = ctx.views.utils.importCollections(parent, ctx.body.ownerDocument.defaultView!);
    const result = await ctx.batchResults.run(
      parent,
      chosen,
      {
        owner: ctx.body,
        collections,
        downloadOA: Boolean(Zotero.Prefs.get(`${config.addonRef}.downloadOA`)),
        createSubCollection: true,
        createManifestNote: true,
        resolveMissingDOI: true,
      },
      chosen.map((ref) => all.indexOf(ref) + 1)
    );
    if (same()) {
      ctx.invalidateLibraryMatches();
      ctx.label().textContent =
        (result.cancelled ? getString("cards-import-cancelled") : importSummaryText(result)) +
        (result.failedCount ? " · " + importFailureText(result.failures[0]) : "");
    }
    return result.cancelled ? getString("cards-import-cancelled") : importSummaryText(result);
  } else if (action === "rollback") {
    const id = await BatchImporter.latestBatchID(parent);
    if (!id) return getString("relatedbox-no-rollback-batch");
    const count = await ctx.views.rollbackReferences(parent, id);
    if (same()) {
      ctx.batchResults.clear();
      ctx.invalidateLibraryMatches();
      ctx.label().textContent = getString("cards-rollback-summary", { args: { count } });
    }
    return getString("cards-rollback-summary", { args: { count } });
  } else {
    throw new Error("Unknown RefFlow action");
  }

  return getString("cards-settings-done");
}
