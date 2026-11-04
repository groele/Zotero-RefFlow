import { getString } from "../utils/locale";
import BatchImporter from "./batchImporter";
import { workIdentity } from "./workIdentity";
import Views from "./views";

export interface BatchOperationContext {
  importJobs: Map<string, { job: ReturnType<typeof BatchImporter.importAll>; refs: ItemBaseInfo[] }>;
  importOwnerIDs: WeakMap<object, number>;
  importOwnerSequence: number;
  pendingImports: WeakMap<Element, Map<number, number>>;
  getPanes: () => Set<HTMLElement>;
  syncCancelButton: (body: Element) => void;
  isDisposed: () => boolean;
}

/**
 * Handles batch reference import with deduping, job coordination, and UI progress tracking.
 */
export async function importReferencesBatch(
  views: Views,
  parent: Zotero.Item,
  refs: ItemBaseInfo[],
  options: any,
  ctx: BatchOperationContext
) {
  if (ctx.isDisposed()) throw new Error("RefFlow is stopping");
  if (parent && typeof parent.isEditable === "function" && !parent.isEditable()) {
    throw new Error(getString("cards-library-readonly") || "Item library is read-only");
  }
  const copyRefs = [...refs];
  const opts = { downloadOA: true, createSubCollection: true, createManifestNote: true, ...options };
  let ownerID = 0;
  if (opts.owner) {
    ownerID = ctx.importOwnerIDs.get(opts.owner) || 0;
    if (!ownerID) {
      ownerID = ctx.importOwnerSequence = (ctx.importOwnerSequence || 0) + 1;
      ctx.importOwnerIDs.set(opts.owner, ownerID);
    }
  }
  const key = JSON.stringify([
    parent.libraryID,
    parent.id,
    copyRefs.map(workIdentity),
    opts.collections ?? parent.getCollections(),
    (opts.relatedParents || []).map((item: Zotero.Item) => item.id),
    Boolean(opts.createSubCollection),
    Boolean(opts.createManifestNote),
    Boolean(opts.downloadOA),
    Boolean(opts.allowMetadataWithoutDOI),
    opts.translatorTimeoutMs ?? 20000,
    opts.budgetMs ?? 300000,
    ownerID
  ]);
  const pending = ctx.importJobs.get(key);
  if (pending && !opts.signal) {
    const result = await pending.job;
    copyRefs.forEach((ref, index) => { ref._item = pending.refs[index]._item; });
    return result;
  }
  const panels = [...ctx.getPanes()].filter(
    (body) => (!opts.owner || opts.owner === body) && Number(body.getAttribute("data-refflow-item-id")) === parent.id
  );
  for (const body of panels) {
    let pendingMap = ctx.pendingImports.get(body);
    if (!pendingMap) {
      pendingMap = new Map();
      ctx.pendingImports.set(body, pendingMap);
    }
    pendingMap.set(parent.id, (pendingMap.get(parent.id) || 0) + 1);
    ctx.syncCancelButton(body);
  }
  let job: ReturnType<typeof BatchImporter.importAll>;
  try {
    job = BatchImporter.importAll(parent, copyRefs, opts);
  } catch (error) {
    job = Promise.reject(error);
  }
  if (!opts.signal) ctx.importJobs.set(key, { job, refs: copyRefs });
  try {
    return await job;
  } finally {
    if (ctx.importJobs.get(key)?.job === job) ctx.importJobs.delete(key);
    for (const body of panels) {
      const pendingMap = ctx.pendingImports.get(body);
      const count = (pendingMap?.get(parent.id) || 1) - 1;
      if (count > 0) pendingMap?.set(parent.id, count);
      else pendingMap?.delete(parent.id);
      ctx.syncCancelButton(body);
    }
  }
}

/**
 * Rolls back an import batch with safety notifications.
 */
export async function rollbackReferencesBatch(parent: Zotero.Item, batchID: string) {
  if (parent && typeof parent.isEditable === "function" && !parent.isEditable()) {
    throw new Error(getString("cards-library-readonly") || "Item library is read-only");
  }
  try {
    const outcome = await BatchImporter.rollbackBatchDetailed(parent, batchID);
    const removed = outcome.removed;
    const retained = outcome.retainedIDs.length;
    if (retained) {
      new ztoolkit.ProgressWindow("RefFlow").createLine({ text: getString("cards-rollback-retained", { args: { count: retained } }), type: "default" }).show();
    }
    return removed;
  } catch (error) {
    ztoolkit.log("Reference rollback failed", error);
    const failure = new Error(getString("cards-rollback-failed"));
    (failure as any).cause = error;
    throw failure;
  }
}
