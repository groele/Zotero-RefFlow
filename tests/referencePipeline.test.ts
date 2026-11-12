import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchPdfReferences } from "../src/modules/referenceSourceFetchers";
import { performReferences } from "../src/modules/referencePipeline";

function mockItem(id = 1) {
  const fields: Record<string, string> = { title: "Target Paper", DOI: "", url: "", date: "2024" };
  return {
    id,
    libraryID: 1,
    isAttachment: () => false,
    getAttachments: () => [],
    getField: (f: string) => fields[f] || "",
    getCreators: () => [],
  } as unknown as Zotero.Item;
}

function createTask() {
  const controller = new AbortController();
  return {
    signal: controller.signal,
    isCurrent: () => true,
  } as any;
}

test("fetchPdfReferences does not cache failure as empty when PDF parsing fails or attachment is missing", async () => {
  const savedStore = new Map<string, any>();
  let pdfCalls = 0;
  let shouldThrow = true;
  let smartCalls = 0;
  const attachment = { id: 99, isPDFAttachment: () => true } as any;

  const views: any = {
    storage: {
      getAsync: async (_item: any, key: string) => savedStore.get(key),
      set: async (_item: any, key: string, val: any) => { savedStore.set(key, val); },
    },
    pdfAttachment: async () => attachment,
    mayPersist: () => true,
    referenceDescription: (r: any) => r.source,
    smartReferences: async () => {
      smartCalls++;
      return { source: "OpenAlex", references: [], status: "empty", attempts: [] };
    },
    utils: {
      PDF: {
        getDiagnostics: () => ({ scanLimited: false }),
        getReferences: async () => {
          pdfCalls++;
          if (shouldThrow) throw new Error("PDF worker failure");
          return [{ title: "Recovered PDF Reference" }];
        },
      },
    },
  };

  const label = { textContent: "", title: "" } as any;
  const item = mockItem(10);

  // First attempt fails during PDF extraction
  const res1 = await fetchPdfReferences(views, item, undefined, createTask(), true, false, "sig-1", label, () => {});
  assert.equal(pdfCalls, 1);
  assert.equal(smartCalls, 1);
  assert.equal(savedStore.has("References-PDF"), false);
  assert.equal(res1?.references.length, 0);

  // Subsequent local: true run must NOT treat prior failure as cached empty and must retry PDF
  shouldThrow = false;
  const res2 = await fetchPdfReferences(views, item, undefined, createTask(), true, false, "sig-1", label, () => {});
  assert.equal(pdfCalls, 2);
  assert.equal(res2?.references.length, 1);
  assert.equal(savedStore.get("References-PDF")?.snapshot?.status, "success");
});

test("fetchPdfReferences caches clean empty PDF extraction with short retention", async () => {
  const savedStore = new Map<string, any>();
  let pdfCalls = 0;
  const attachment = { id: 100, isPDFAttachment: () => true } as any;

  const views: any = {
    storage: {
      getAsync: async (_item: any, key: string) => savedStore.get(key),
      set: async (_item: any, key: string, val: any) => { savedStore.set(key, val); },
    },
    pdfAttachment: async () => attachment,
    mayPersist: () => true,
    referenceDescription: (r: any) => r.source,
    smartReferences: async () => ({ source: "OpenAlex", references: [], status: "empty", attempts: [] }),
    utils: {
      PDF: {
        getDiagnostics: () => ({ scanLimited: false }),
        getReferences: async () => {
          pdfCalls++;
          return [];
        },
      },
    },
  };

  const label = { textContent: "", title: "" } as any;
  const item = mockItem(11);

  await fetchPdfReferences(views, item, undefined, createTask(), true, false, "sig-clean-empty", label, () => {});
  assert.equal(pdfCalls, 1);
  assert.equal(savedStore.get("References-PDF")?.snapshot?.status, "empty");

  // Cached clean empty result should satisfy subsequent local: true call
  await fetchPdfReferences(views, item, undefined, createTask(), true, false, "sig-clean-empty", label, () => {});
  assert.equal(pdfCalls, 1);
});

test("performReferences clears stale cards on empty result and keeps previous only on unavailable", async () => {
  const attrs = new Map<string, string>([
    ["source", "Auto"],
    ["data-refflow-type", "References"],
  ]);
  let cleared = 0;
  let l10nArgs: string | undefined;
  const label = { textContent: "", innerText: "", title: "" };
  const panel: any = {
    references: [{ title: "Stale Previous Reference" }],
    _cards: {
      clear: () => { cleared++; },
      updateStatus: () => {},
    },
    _setL10nArgs: (args: string) => { l10nArgs = args; },
    getAttribute: (name: string) => attrs.get(name) ?? null,
    setAttribute: (name: string, val: string) => { attrs.set(name, val); },
    querySelector: (selector: string) => (selector === "label#reference-num" ? label : undefined),
    ownerDocument: { defaultView: {} },
  };

  let nextResult: any = {
    source: "OpenAlex",
    references: [],
    status: "empty",
    partial: false,
    attempts: ["OpenAlex: 0"],
  };

  const views: any = {
    storage: {
      getAsync: async () => undefined,
      set: async () => {},
    },
    utils: {
      getReader: () => undefined,
      API: { get: async () => ({}) },
    },
    pdfCacheSignature: async () => "pdf-sig",
    mayPersist: () => false,
    referenceDescription: (r: any) => r.source,
    smartReferences: async () => nextResult,
    sortReferences: async () => {},
  };

  // Case 1: Confirmed empty clears stale cards and updates count to 0
  await performReferences(views, panel, false, false, mockItem(20), undefined, createTask());
  assert.equal(cleared, 1);
  assert.equal(panel.references.length, 0);
  assert.equal(l10nArgs, JSON.stringify({ count: 0 }));

  // Case 2: Unavailable from provider retains displayed cards via showUnavailable
  panel.references = [{ title: "Retained Useful Reference" }];
  nextResult = {
    source: "OpenAlex",
    references: [],
    status: "unavailable",
    retained: true,
    partial: true,
    attempts: ["OpenAlex: network error"],
  };
  await assert.rejects(
    performReferences(views, panel, false, false, mockItem(20), undefined, createTask()),
    /OpenAlex: network error/
  );
  assert.equal(cleared, 1);
  assert.equal(panel.references.length, 1);

  // Case 3: Confirmed-empty cached neighborhood clears stale cards; unavailable keeps them
  const neighborhoodStore = new Map<string, any>();
  views.mayPersist = () => true;
  views.storage.getAsync = async (_item: any, k: string) => neighborhoodStore.get(k);
  views.storage.set = async (_item: any, k: string, v: any) => { neighborhoodStore.set(k, v); };
  const citeItem = mockItem(21);
  (citeItem as any).getField = (f: string) => (f === "DOI" ? "10.1234/cite-target" : "");
  views.utils.API = {
    openAlex: {
      getNeighborhood: async () => ({ references: [], total: 0, truncated: false }),
    },
    semanticScholar: {
      neighborhood: async () => ({ references: [], status: "empty" }),
    },
  };
  panel.setAttribute("data-refflow-type", "Citations");
  panel.setAttribute("data-refflow-result-type", "Citations");
  panel.references = [{ title: "Previous Citations List" }];
  // Populate confirmed-empty neighborhood cache
  await performReferences(views, panel, false, false, citeItem, undefined, createTask());
  assert.equal(panel.references.length, 0);
  // Restore stale list on panel and verify local: true cached empty still clears rather than keeping
  panel.references = [{ title: "Stale Citations List" }];
  await performReferences(views, panel, true, false, citeItem, undefined, createTask());
  assert.equal(panel.references.length, 0);
  // If cached snapshot status is unavailable, performReferences preserves rendered list
  const entry = neighborhoodStore.get("References-API-Citations");
  entry.snapshot.status = "unavailable";
  panel.references = [{ title: "Retained On Unavailable" }];
  await performReferences(views, panel, true, false, citeItem, undefined, createTask());
  assert.equal(panel.references.length, 1);
});
