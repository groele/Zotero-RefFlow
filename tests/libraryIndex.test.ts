import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { LibraryMatchIndex } from "../src/modules/libraryIndex";
import BatchImporter from "../src/modules/batchImporter";
import Utils from "../src/modules/utils";
import CitationVerifier from "../src/modules/verifier";
import { getItemDOI, applyItemDOI } from "../src/modules/workIdentity";

function makeLibItem(opts: {
  id: number;
  title: string;
  doi?: string;
  extra?: string;
  date?: string;
  creators?: any[];
  itemTypeID?: number;
  regular?: boolean;
  deleted?: boolean;
}) {
  const fields: Record<string, string> = {
    title: opts.title,
    DOI: opts.doi || "",
    extra: opts.extra || "",
    date: opts.date || "",
  };
  return {
    id: opts.id,
    libraryID: 1,
    itemTypeID: opts.itemTypeID ?? 1,
    deleted: Boolean(opts.deleted),
    isRegularItem: () => opts.regular ?? true,
    isNote: () => false,
    isAttachment: () => false,
    getField: (f: string) => fields[f] || "",
    setField: (f: string, v: any) => { fields[f] = String(v ?? ""); },
    getCreators: () => opts.creators || [],
  } as unknown as Zotero.Item;
}

test("LibraryMatchIndex rejects conflicting DOIs even when titles are identical", () => {
  const idx = new LibraryMatchIndex();
  const existing = makeLibItem({
    id: 10,
    title: "Attention Is All You Need",
    doi: "10.5555/original-paper",
    date: "2017",
    creators: [{ lastName: "Vaswani" }],
  });
  idx.recordMatch(existing, 1);

  const match = idx.findFastMatch({
    title: "Attention Is All You Need",
    authors: ["Vaswani"],
    year: "2017",
    identifiers: { DOI: "10.5555/different-paper" },
  } as any, 1);
  assert.equal(match, undefined);
});

test("LibraryMatchIndex indexes Extra DOI and enforces year/author evidence when DOI is one-sided", () => {
  const idx = new LibraryMatchIndex();
  const withExtraDOI = makeLibItem({
    id: 11,
    title: "A Survey on Deep Transfer Learning",
    extra: "arXiv:1808.01974\nDOI: 10.1007/extra-doi-1",
    date: "2018",
    creators: [{ lastName: "Tan" }],
  });
  const doiLess = makeLibItem({
    id: 12,
    title: "Structured Neural Reasoning Across Graphs",
    date: "2020",
    creators: [{ lastName: "Smith" }],
  });
  idx.recordMatch(withExtraDOI, 1);
  idx.recordMatch(doiLess, 1);

  assert.equal(getItemDOI(withExtraDOI), "10.1007/extra-doi-1");
  assert.equal(
    idx.findFastMatch({ title: "Completely Unrelated Title", identifiers: { DOI: "10.1007/extra-doi-1" } } as any, 1),
    withExtraDOI
  );
  // One-sided DOI with conflicting year rejects
  assert.equal(
    idx.findFastMatch({
      title: "Structured Neural Reasoning Across Graphs",
      authors: ["Smith"],
      year: "2014",
      identifiers: { DOI: "10.1234/new-doi" },
    } as any, 1),
    undefined
  );
  // One-sided DOI without year or author evidence rejects
  assert.equal(
    idx.findFastMatch({
      title: "Structured Neural Reasoning Across Graphs",
      authors: [],
      identifiers: { DOI: "10.1234/new-doi" },
    } as any, 1),
    undefined
  );
  // One-sided DOI with matching author + year accepts
  assert.equal(
    idx.findFastMatch({
      title: "Structured Neural Reasoning Across Graphs",
      authors: ["Smith"],
      year: "2020",
      identifiers: { DOI: "10.1234/new-doi" },
    } as any, 1),
    doiLess
  );
});

test("applyItemDOI stores DOI in Extra when item type does not support DOI field", () => {
  const savedItemFields = Zotero.ItemFields;
  Zotero.ItemFields = {
    getID: (f: string) => f,
    isValidForType: (f: string, typeID: number) => !(f === "DOI" && typeID === 99),
  } as any;
  try {
    const item = makeLibItem({ id: 20, title: "Book Chapter", extra: "Pages: 12-30", itemTypeID: 99 });
    applyItemDOI(item, "https://doi.org/10.1000/CHAPTER.ONE");
    assert.equal(item.getField("DOI"), "");
    assert.equal(getItemDOI(item), "10.1000/chapter.one");
    assert.match(String(item.getField("extra")), /DOI:\s*10\.1000\/chapter\.one/);
  } finally {
    Zotero.ItemFields = savedItemFields;
  }
});

test("Utils.searchLibraryItem queries extra for DOI matches and falls back cleanly", async () => {
  const z: any = Zotero;
  const savedSearch = z.Search;
  const savedItems = z.Items;
  const queries: any[] = [];
  const target = makeLibItem({
    id: 30,
    title: "Extra DOI Target Paper",
    extra: "DOI: 10.5555/in-extra",
    date: "2022",
    creators: [{ lastName: "Lee" }],
  });
  z.Search = class {
    libraryID = 1;
    conditions: any[] = [];
    addCondition(field: string, op: string, val: string) {
      this.conditions.push({ field, op, val });
    }
    async search() {
      queries.push([...this.conditions]);
      return [30];
    }
  };
  z.Items = {
    getAsync: async (ids: number[]) => ids.map(id => (id === 30 ? target : undefined)).filter(Boolean),
  };
  try {
    const utils = new Utils();
    const matched = await utils.searchLibraryItem({
      title: "Extra DOI Target Paper",
      authors: ["Lee"],
      year: "2022",
      identifiers: { DOI: "10.5555/in-extra" },
    } as any, 1);
    assert.equal(matched, target);
    assert.ok(queries[0].some((c: any) => c.field === "extra" && c.op === "contains" && c.val === "10.5555/in-extra"));
  } finally {
    z.Search = savedSearch;
    z.Items = savedItems;
  }
});

test("BatchImporter backfills missing DOI on reused item and falls back to Extra on unsupported itemType", async () => {
  const z: any = Zotero;
  const tool: any = ztoolkit;
  const saved = Object.fromEntries(["Libraries", "DB", "Translate", "Item", "ItemTypes", "ItemFields", "Collections", "Collection", "getMainWindow", "Items", "Search"].map(k => [k, z[k]]));
  const oldUtils = (BatchImporter as any)._utils;
  const oldProgress = tool.ProgressWindow;
  tool.ProgressWindow = class {
    createLine() { return this; }
    show() { return this; }
    changeLine() {}
    changeHeadline() {}
    startCloseTimer() {}
  };
  let ids = 500;
  const createdItems: any[] = [];
  class MockItem {
    id = 0;
    key = "";
    libraryID = 1;
    itemTypeID = 1;
    fields: Record<string, any> = {};
    collections: number[] = [];
    creators: any[] = [];
    relatedItems: string[] = [];
    constructor(public itemType = "journalArticle") {
      this.itemTypeID = itemType === "book" ? 2 : 1;
    }
    isRegularItem() { return true; }
    getField(f: string) { return this.fields[f] || ""; }
    setField(f: string, v: any) { this.fields[f] = v; }
    getCollections() { return [...this.collections]; }
    addToCollection(id: number) { this.collections.push(id); }
    getAttachments() { return []; }
    getCreators() { return this.creators; }
    setCreators(v: any[]) { this.creators = v; }
    addRelatedItem(item: any) { this.relatedItems.push(item.key); }
    async save() {
      if (!this.id) { this.id = ++ids; this.key = "K" + this.id; createdItems.push(this); }
      return this.id;
    }
  }
  const existingItem = new MockItem("journalArticle");
  existingItem.id = 200;
  existingItem.key = "EX200";
  existingItem.fields = { title: "Existing Paper Without DOI", date: "2021" };
  existingItem.creators = [{ lastName: "Chen" }];

  const parent = new MockItem("journalArticle");
  parent.id = 1;
  parent.key = "PARENT";
  parent.collections = [7];

  let nextTranslateRows: any[] = [];
  z.Item = MockItem;
  z.ItemTypes = { getID: (t: string) => (t === "book" ? 2 : 1) };
  z.ItemFields = {
    getID: (f: string) => f,
    isValidForType: (f: string, typeID: number) => !(f === "DOI" && typeID === 2),
  };
  z.Libraries = { get: () => ({ editable: true, filesEditable: true }) };
  z.DB = { executeTransaction: (fn: any) => fn() };
  z.Collections = { getAsync: async (id: number) => ({ id, libraryID: 1 }) };
  z.Collection = class { libraryID = 1; id = 42; async save() {} };
  z.Items = { getAsync: async (req: number | number[]) => Array.isArray(req) ? [existingItem] : existingItem };
  z.Search = class { libraryID = 1; addCondition() {} async search() { return []; } };
  z.getMainWindow = () => ({ IOUtils: { exists: async () => false, writeJSON: async () => {} } });
  z.Translate = {
    Search: class {
      setIdentifier() {}
      async getTranslators() { return ["mock"]; }
      setTranslator() {}
      async translate() { return nextTranslateRows; }
    },
  };
  BatchImporter.setUtils({
    clearLibraryItemCache() {},
    splitCreator: (name: string) => ({ name }),
    searchLibraryItem: async (ref: any) => {
      if (ref.title === existingItem.getField("title")) return existingItem;
      return undefined;
    },
  } as any);

  try {
    // 1. Existing DOI-less item receives DOI backfill
    nextTranslateRows = [{ title: "Existing Paper Without DOI", DOI: "10.1111/backfill", itemType: "journalArticle" }];
    const r1 = await BatchImporter.importAll(parent as any, [{
      title: "Existing Paper Without DOI",
      authors: ["Chen"],
      year: "2021",
      identifiers: { DOI: "10.1111/backfill" },
    } as any], { downloadOA: false, createSubCollection: false, createManifestNote: false });
    assert.equal(r1.existingCount, 1);
    assert.equal(CitationVerifier.normalizeDOI(existingItem.getField("DOI")), "10.1111/backfill");

    // 2. Unsupported itemType (book, typeID 2) stores DOI in Extra instead of silently dropping it
    nextTranslateRows = [{ title: "Monograph Without DOI Field", itemType: "book", DOI: "10.2222/book-doi" }];
    const r2 = await BatchImporter.importAll(parent as any, [{
      title: "Monograph Without DOI Field",
      type: "book",
      authors: ["Ada Lovelace"],
      year: "2024",
      identifiers: { DOI: "10.2222/book-doi" },
    } as any], { downloadOA: false, createSubCollection: false, createManifestNote: false });
    assert.equal(r2.importedCount, 1);
    assert.equal(createdItems.length, 1);
    assert.equal(createdItems[0].getField("DOI"), "");
    assert.equal(getItemDOI(createdItems[0]), "10.2222/book-doi");
  } finally {
    Object.assign(z, saved);
    tool.ProgressWindow = oldProgress;
    (BatchImporter as any)._utils = oldUtils;
  }
});
