import batchJournal from "./batchJournal";
import Utils from "./utils";
import {
  type BatchRecord,
  metadataFingerprint,
  usesItem,
  needsRelation,
  needsMembership,
  validateBatchRecord,
  sameCollectionState
} from "./batchOwnership";

export class BatchRollback {
  private static _utils?: Utils;
  private static get utils() { return this._utils ??= new Utils(); }
  public static setUtils(utils: Utils) { this._utils = utils; }
  private static queues = new Map<number, Promise<any>>();
  public static lastRollback = { retainedIDs: [] as number[] };

  public static serial<T>(libraryID: number, job: () => Promise<T>): Promise<T> {
    const task = (this.queues.get(libraryID) || Promise.resolve()).catch(() => {}).then(job);
    this.queues.set(libraryID, task);
    task.then(
      () => { if (this.queues.get(libraryID) === task) this.queues.delete(libraryID); },
      () => { if (this.queues.get(libraryID) === task) this.queues.delete(libraryID); }
    );
    return task;
  }

  public static transaction<T>(libraryID: number, job: () => Promise<T>): Promise<T> {
    return batchJournal.transaction(job, libraryID);
  }

  public static checkStopped(signal?: AbortSignal) {
    if (signal?.aborted) {
      const error = new Error("Import stopped; completed changes remain available for batch rollback");
      error.name = "AbortError";
      throw error;
    }
  }

  public static marker(batchID: string): string { return `import_batch: ${batchID}`; }
  public static recordPrefix(batchID: string): string { return `refnexus_record_${batchID}: `; }
  public static async storeRecord(parent: Zotero.Item, batchID: string, record: BatchRecord) {
    await batchJournal.put(parent, batchID, record);
  }

  /** Archive verified legacy evidence before removing only its exact internal lines. */
  public static async migrateRecords(libraryID: number, parent?: Zotero.Item, signal?: AbortSignal) {
    this.checkStopped(signal);
    const search: any = new Zotero.Search();
    search.libraryID = libraryID;
    search.addCondition("extra", "contains", "refnexus_record_");
    const found = await (Zotero.Items as any).getAsync(await search.search()) as Zotero.Item[];
    const owners = [...new Map([...found, ...(parent ? [parent] : [])].map(item => [item.id, item])).values()];
    for (const owner of owners) {
      this.checkStopped(signal);
      if (!owner || owner.deleted || owner.libraryID !== libraryID) continue;
      const extra = String(owner.getField("extra") || ""), lines = extra.split(/\r?\n/), remove = new Set<string>();
      for (const line of lines) {
        this.checkStopped(signal);
        const match = line.match(/^refnexus_record_(refnexus_batch_\w+):[ \t]*(.*)$/);
        if (!match) continue;
        const record = validateBatchRecord(JSON.parse(match[2]), owner.id, libraryID);
        const existing = await batchJournal.get(owner, match[1]);
        if (existing && JSON.stringify(existing) !== JSON.stringify(record)) {
          throw new Error("Conflicting local and legacy import journals; original Extra preserved");
        }
        await batchJournal.put(owner, match[1], record);
        remove.add(line);
        remove.add(`refnexus_batch_parent: ${match[1]}`);
        for (const id of record.createdIDs) {
          this.checkStopped(signal);
          const item = await Zotero.Items.getAsync(id) as Zotero.Item;
          if (!item || item.libraryID !== libraryID || item.deleted) continue;
          const text = String(item.getField("extra") || ""), marker = this.marker(match[1]);
          if (text.split(/\r?\n/).includes(marker)) {
            batchJournal.track(item);
            item.setField("extra", text.split(/\r?\n/).filter(line => line !== marker).join(text.includes("\r\n") ? "\r\n" : "\n"));
            await item.save({ skipSelect: true });
          }
        }
      }
      this.checkStopped(signal);
      if (remove.size) {
        const current = String(owner.getField("extra") || "");
        if ([...remove].some(line => line.startsWith("refnexus_record_") && !current.split(/\r?\n/).includes(line))) {
          throw new Error("Legacy journal changed during migration; original Extra preserved");
        }
        batchJournal.track(owner);
        owner.setField("extra", current.split(/\r?\n/).filter(line => !remove.has(line)).join(current.includes("\r\n") ? "\r\n" : "\n"));
        await owner.save({ skipSelect: true });
      }
    }
  }

  public static async migrateLegacy(parent: Zotero.Item) {
    if (!(Zotero as any).Libraries.get(parent.libraryID)?.editable) return;
    return this.serial(parent.libraryID, () => this.transaction(parent.libraryID, () => this.migrateRecords(parent.libraryID, parent)));
  }

  public static async latestBatchID(parent: Zotero.Item): Promise<string | undefined> {
    return this.serial(parent.libraryID, () => this.transaction(parent.libraryID, async () => {
      await this.migrateRecords(parent.libraryID, parent);
      const rows = batchJournal.all(parent.libraryID).filter(row => row.parentID === parent.id);
      if (rows.length) return rows[rows.length - 1].batchID;
      return [...String(parent.getField("extra") || "").matchAll(/^(?:refnexus_batch_parent|ref_batch_parent): (ref(?:nexus)?_batch_\w+)$/gm)].pop()?.[1];
    }));
  }

  public static rollbackBatch(parent: Zotero.Item, batchID: string): Promise<number> {
    return this.rollbackBatchDetailed(parent, batchID).then(result => result.removed);
  }

  public static rollbackBatchDetailed(parent: Zotero.Item, batchID: string): Promise<{ removed: number; retainedIDs: number[] }> {
    return this.serial(parent.libraryID, async () => {
      const outcome = { retainedIDs: [] as number[] };
      const removed = await this.rollback(parent, batchID, outcome);
      return { removed, retainedIDs: [...outcome.retainedIDs] };
    });
  }

  public static async otherRecords(parent: Zotero.Item, batchID: string): Promise<Array<{ owner: Zotero.Item; batchID: string; record: BatchRecord }>> {
    await this.migrateRecords(parent.libraryID, parent);
    const records: Array<{ owner: Zotero.Item; batchID: string; record: BatchRecord }> = [];
    for (const row of batchJournal.all(parent.libraryID)) {
      if (row.batchID === batchID) continue;
      const owner = await Zotero.Items.getAsync(row.parentID) as Zotero.Item;
      if (!owner || owner.deleted) continue;
      records.push({ owner, batchID: row.batchID, record: (await batchJournal.get(owner, row.batchID))! });
    }
    return records;
  }

  public static async rollback(parent: Zotero.Item, batchID: string, outcome: { retainedIDs: number[] }): Promise<number> {
    this.lastRollback = { retainedIDs: [] };
    if (!/^ref(?:nexus)?_batch_[A-Za-z0-9_]+$/.test(batchID)) return 0;
    if (!(Zotero as any).Libraries.get(parent.libraryID)?.editable) throw new Error("This library is read-only");
    const touched = new Set<Zotero.Item>([parent]);
    try {
      return await this.transaction(parent.libraryID, async () => {
        await this.migrateRecords(parent.libraryID, parent);
        if (!await batchJournal.get(parent, batchID)) return this.rollbackLegacy(parent, batchID, outcome);
        return this.rollbackRecord(parent, batchID, touched, outcome);
      });
    } catch (error) {
      await Promise.allSettled([...touched].map(item => Promise.resolve().then(() => (item as any).reload(null, true))));
      this.utils.clearLibraryItemCache();
      throw error;
    }
  }

  /** Read all protection evidence after admission to the write transaction. */
  public static async rollbackRecord(parent: Zotero.Item, batchID: string, touched: Set<Zotero.Item>, outcome: { retainedIDs: number[] }): Promise<number> {
    if (parent.deleted || !parent.isRegularItem() || !(Zotero as any).Libraries.get(parent.libraryID)?.editable) {
      throw new Error("The rollback parent or library is no longer editable");
    }
    const record = await batchJournal.get(parent, batchID);
    if (!record) return 0;
    const journals = await this.otherRecords(parent, batchID);
    const others = journals.map(journal => journal.record);
    const retained = new Set<number>();
    for (const id of record.createdIDs) {
      const item = await Zotero.Items.getAsync(id) as Zotero.Item;
      if (!item || item.deleted) continue;
      const state = record.states?.[id];
      const externalRelations = item.relatedItems.some(key => !(state?.related || record.relations.filter(edge => edge.id === id).map(edge => {
        const origin = Zotero.Items.get(edge.parentID || parent.id);
        return origin ? origin.key : undefined;
      })).includes(key));
      const ownAttachments = record.attachments.filter(row => row.parentID === id).map(row => row.id);
      const children = await (Zotero.Items as any).getAsync(item.getAttachments()) as Zotero.Item[];
      const annotated = children.some(child => (child as any).isFileAttachment?.() && (child as any).getAnnotations().length);
      const editedAttachment = children.some(child => {
        const owned = record.attachments.find(row => row.id === child.id);
        return owned && (!owned.metadata || metadataFingerprint(child) !== owned.metadata);
      });
      if (!state || others.some(other => usesItem(other, id)) || externalRelations ||
        state && (metadataFingerprint(item) !== state.metadata || item.getCollections().some(col => !state.collections.includes(col)) || state.collections.some(col => !item.getCollections().includes(col)) || state.related.some(key => !item.relatedItems.includes(key))) ||
        item.getAttachments().some(child => !ownAttachments.includes(child)) || item.getNotes().length || annotated || editedAttachment) {
        retained.add(id);
      }
    }
    const ids: number[] = [];
    for (const id of [...record.createdIDs, record.noteID || 0, ...record.attachments.map(a => a.id)]) {
      if (!id || id === parent.id) continue;
      const item = await Zotero.Items.getAsync(id) as Zotero.Item;
      if (!item || item.libraryID !== parent.libraryID || item.deleted) continue;
      touched.add(item);
      const attachment = record.attachments.find(a => a.id === id);
      if (attachment && ((item as any).isFileAttachment?.() && (item as any).getAnnotations().length || !attachment.metadata || metadataFingerprint(item) !== attachment.metadata)) retained.add(id);
      if (item.isNote() && (!record.noteState || metadataFingerprint(item) !== record.noteState)) retained.add(id);
      if (retained.has(id) || attachment && retained.has(attachment.parentID)) continue;
      if (attachment ? item.isAttachment() && item.parentID === attachment.parentID : (item.isNote() ? item.parentID === parent.id && item.getTags().some(tag => tag.tag === `refnexus:batch:${batchID}`) : record.createdIDs.includes(id))) {
        ids.push(id);
      }
    }
    for (const change of record.relations) {
      const item = await Zotero.Items.getAsync(change.id) as Zotero.Item;
      const origin = change.parentID && change.parentID !== parent.id ? await Zotero.Items.getAsync(change.parentID) as Zotero.Item : parent;
      if (!item || item.libraryID !== parent.libraryID || !origin || origin.libraryID !== parent.libraryID) continue;
      touched.add(item);
      touched.add(origin);
      const shared = journals.find(journal => needsRelation(journal.record, item.id, origin.id));
      if (shared) {
        touched.add(shared.owner);
        const edge = shared.record.relations.find(edge => edge.id === item.id && (edge.parentID || shared.record.parentID) === origin.id);
        if (edge) { edge.parentAdded ||= change.parentAdded; edge.itemAdded ||= change.itemAdded; } else shared.record.relations.push({ ...change, parentID: origin.id });
        await this.storeRecord(shared.owner, shared.batchID, shared.record);
        await shared.owner.save({ skipSelect: true });
        continue;
      }
      if (change.parentAdded) origin.removeRelatedItem(item);
      if (change.itemAdded) item.removeRelatedItem(origin);
      if (origin.id !== parent.id) await origin.save({ skipSelect: true });
      await item.save({ skipSelect: true });
    }
    for (const change of record.memberships) {
      const item = await Zotero.Items.getAsync(change.id) as Zotero.Item;
      if (item && item.libraryID === parent.libraryID) {
        touched.add(item);
        const shared = journals.find(journal => needsMembership(journal.record, item.id, change.collectionID));
        if (shared) {
          touched.add(shared.owner);
          if (!shared.record.memberships.some(row => row.id === item.id && row.collectionID === change.collectionID)) shared.record.memberships.push(change);
          await this.storeRecord(shared.owner, shared.batchID, shared.record);
          await shared.owner.save({ skipSelect: true });
        } else {
          item.removeFromCollection(change.collectionID);
          await item.save({ skipSelect: true });
        }
      }
    }
    if (ids.length) await Zotero.Items.trash(ids);
    parent.setField("extra", String(parent.getField("extra") || "").split(/\r?\n/).filter(line => line !== `refnexus_batch_parent: ${batchID}` && line !== `ref_batch_parent: ${batchID}` && !line.startsWith(this.recordPrefix(batchID))).join("\n"));
    await parent.save({ skipSelect: true });
    batchJournal.remove(parent, batchID);
    if (record.collectionID) {
      const col = await Zotero.Collections.getAsync(record.collectionID) as Zotero.Collection;
      if (col && col.libraryID === parent.libraryID && sameCollectionState(col, record.collectionState) && !record.createdIDs.some(id => retained.has(id)) && !col.getChildItems(true, false).length && !col.hasChildCollections(true)) {
        await col.erase();
      }
    }
    outcome.retainedIDs = [...retained];
    this.lastRollback = { retainedIDs: [...retained] };
    this.utils.clearLibraryItemCache();
    return ids.length;
  }

  /** Old journals identify created items but cannot prove which old relations were added. */
  public static async rollbackLegacy(parent: Zotero.Item, batchID: string, outcome: { retainedIDs: number[] }): Promise<number> {
    if (!String(parent.getField("extra") || "").split(/\r?\n/).some(line => line === `ref_batch_parent: ${batchID}` || line === `refnexus_batch_parent: ${batchID}`)) return 0;
    const search: any = new Zotero.Search();
    search.libraryID = parent.libraryID;
    search.addCondition("extra", "contains", this.marker(batchID));
    const items = await (Zotero.Items as any).getAsync(await search.search()) as Zotero.Item[];
    const ids = items.filter(item => item && item.id !== parent.id && item.libraryID === parent.libraryID && !item.deleted && item.isRegularItem() && String(item.getField("extra") || "").split(/\r?\n/).includes(this.marker(batchID))).map(item => item.id);
    outcome.retainedIDs = [...ids];
    this.lastRollback = { retainedIDs: ids };
    parent.setField("extra", String(parent.getField("extra") || "").split(/\r?\n/).filter(line => line !== `refnexus_batch_parent: ${batchID}` && line !== `ref_batch_parent: ${batchID}` && !line.startsWith(`import_collection_${batchID}:`) && !line.startsWith(`import_related_existing_${batchID}:`)).join("\n"));
    await parent.save({ skipSelect: true });
    this.utils.clearLibraryItemCache();
    return 0;
  }
}

export default BatchRollback;
