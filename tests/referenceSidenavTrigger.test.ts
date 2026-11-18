import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { performReferences } from "../src/modules/referencePipeline";
import {
  fetchAutoOrWebReferences,
  fetchPdfReferences,
  fetchApiReferences
} from "../src/modules/referenceSourceFetchers";
import { fetchNeighborhoodReferences } from "../src/modules/referenceNeighborhood";
import { cacheReferenceResult, cacheReferences } from "../src/modules/referenceCache";
import { bindReferenceSidenavClick } from "../src/modules/referenceSidenavTrigger";
import { registerReferenceItemPane } from "../src/modules/referencePaneDOM";

function mockItem(id = 1, doi = "10.1234/test", typeID = 1) {
  const fields: Record<string, string> = {
    title: `Paper ${id}`,
    DOI: doi,
    url: "",
    date: "2024",
    extra: ""
  };
  return {
    id,
    libraryID: 1,
    key: `KEY${id}`,
    itemTypeID: typeID,
    isRegularItem: () => true,
    isAttachment: () => false,
    getAttachments: () => [],
    getField: (f: string) => fields[f] || "",
    getCreators: () => []
  } as unknown as Zotero.Item;
}

function createTask() {
  const controller = new AbortController();
  return {
    signal: controller.signal,
    isCurrent: () => true
  } as any;
}

function createMockPanel() {
  const attrs = new Map<string, string>([
    ["source", "Auto"],
    ["data-refflow-type", "References"]
  ]);
  const label = { textContent: "", innerText: "", title: "" };
  let renderCalls = 0;
  const panel: any = {
    isConnected: true,
    references: [],
    _cards: {
      clear: () => {
        panel.references = [];
      },
      render: async (list: any[]) => {
        renderCalls++;
        panel.references = list;
      },
      updateStatus: () => {}
    },
    _setL10nArgs: () => {},
    getAttribute: (name: string) => attrs.get(name) ?? null,
    setAttribute: (name: string, value: string) => attrs.set(name, value),
    removeAttribute: (name: string) => attrs.delete(name),
    hasAttribute: (name: string) => attrs.has(name),
    querySelector: (selector: string) => {
      if (selector === "label#reference-num" || selector === "#reference-num") return label;
      return undefined;
    },
    querySelectorAll: () => [],
    ownerDocument: { defaultView: {} },
    get renderCalls() {
      return renderCalls;
    }
  };
  return { panel, label, attrs };
}

test("cacheOnly fetchers never call network APIs or PDF extraction on cache miss, and return hits", async () => {
  const store = new Map<string, any>();
  let apiCalls = 0;
  let pdfCalls = 0;
  const item = mockItem(101);
  const label = { textContent: "", title: "" } as any;
  const views: any = {
    storage: {
      getAsync: async (_item: any, key: string) => store.get(key),
      set: async (_item: any, key: string, val: any) => store.set(key, val)
    },
    mayPersist: () => true,
    referenceDescription: (r: any) => r.source,
    smartReferences: async () => {
      apiCalls++;
      return { source: "OpenAlex", references: [], status: "empty" };
    },
    onlineReferences: async () => {
      apiCalls++;
      return { source: "OpenAlex", references: [], status: "empty" };
    },
    pdfAttachment: async () => ({ id: 999 }),
    utils: {
      PDF: {
        getReferences: async () => {
          pdfCalls++;
          return [];
        },
        getDiagnostics: () => ({ scanLimited: false })
      },
      API: {
        resolveWork: async () => {
          apiCalls++;
          return undefined;
        },
        openAlex: {
          getNeighborhood: async () => {
            apiCalls++;
            return { references: [], total: 0, truncated: false };
          }
        },
        semanticScholar: {
          neighborhood: async () => {
            apiCalls++;
            return { references: [] };
          }
        }
      }
    }
  };

  assert.equal(await fetchAutoOrWebReferences(views, item, "Auto", undefined, createTask(), true, false, "sig-a", label, () => {}, true), undefined);
  assert.equal(await fetchPdfReferences(views, item, undefined, createTask(), true, false, "sig-p", label, () => {}, true), undefined);
  assert.equal(await fetchApiReferences(views, item, undefined, createTask(), true, false, "sig-api", label, () => {}, true), undefined);
  assert.equal(await fetchNeighborhoodReferences(views, item, "Citations", "sig-c", true, createTask(), label, true), undefined);
  assert.equal(apiCalls, 0);
  assert.equal(pdfCalls, 0);

  // Populate cache and verify cacheOnly reads it back cleanly
  store.set("References-API", cacheReferenceResult({
    source: "Crossref",
    references: [{ title: "Cached API Paper", text: "Cached API Paper", identifiers: {} }],
    status: "success"
  }, "sig-api"));
  store.set("References-API-Citations", {
    ...cacheReferences([{ title: "Cached Citing Paper", text: "Cached Citing Paper", identifiers: {} }], "sig-c"),
    snapshot: { source: "OpenAlex", total: 1, truncated: false, status: "success" }
  });

  const apiHit = await fetchApiReferences(views, item, undefined, createTask(), true, false, "sig-api", label, () => {}, true);
  assert.equal(apiHit?.references.length, 1);
  const citeHit = await fetchNeighborhoodReferences(views, item, "Citations", "sig-c", true, createTask(), label, true);
  assert.equal(citeHit?.references.length, 1);
  assert.equal(apiCalls, 0);
  assert.equal(pdfCalls, 0);
});

test("performReferences with cacheOnly loads cross-source local cache and skips uncached items silently", async () => {
  const item = mockItem(102);
  const store = new Map<string, any>();
  let apiCalls = 0;
  const views: any = {
    storage: {
      getAsync: async (_item: any, key: string) => store.get(key),
      set: async () => {}
    },
    pdfCacheSignature: async () => "",
    mayPersist: () => true,
    referenceDescription: (r: any) => r.source,
    smartReferences: async () => {
      apiCalls++;
      return { source: "OpenAlex", references: [], status: "empty" };
    },
    sortReferences: async (p: any) => {
      await p._cards.render(p.references, () => true);
    },
    utils: {
      getReader: () => undefined,
      API: {}
    }
  };

  // Case 1: uncached -> no API calls, label untouched
  const { panel: p1, label: l1 } = createMockPanel();
  await performReferences(views, p1, true, false, item, undefined, createTask(), true);
  assert.equal(apiCalls, 0);
  assert.equal(p1.references.length, 0);
  assert.equal(l1.textContent, "");

  // Case 2: cached under References-API while panel source is Auto -> fallback cache hit loads immediately
  const sig = JSON.stringify(["retrieval-v8", "10.1234/test", "", "Paper 102", "2024", [], "", []]);
  store.set("References-API", cacheReferenceResult({
    source: "Semantic Scholar",
    references: [{ title: "Fallback Cached Ref", text: "Fallback Cached Ref", identifiers: {} }],
    status: "success"
  }, sig));

  const { panel: p2, label: l2 } = createMockPanel();
  await performReferences(views, p2, true, false, item, undefined, createTask(), true);
  assert.equal(apiCalls, 0);
  assert.equal(p2.references.length, 1);
  assert.equal(p2.references[0].title, "Fallback Cached Ref");
  assert.ok(l2.innerText.includes("1"));
});

test("bindReferenceSidenavClick triggers API fetch only on primary sidenav click or when empty", async () => {
  const z: any = Zotero;
  const origItems = z.Items;
  const item = mockItem(205);
  z.Items = { get: (id: number) => (id === 205 ? item : undefined) };

  try {
    const refreshCalls: Array<{ itemID: number; cacheOnly: boolean }> = [];
    const views: any = {
      isDisposed: () => false,
      refreshReferences: async (_panel: any, _local: boolean, _page: boolean, _toggle: boolean, target: any, _reader: any, cacheOnly = false) => {
        refreshCalls.push({ itemID: target.id, cacheOnly });
      },
      utils: { getReader: () => undefined }
    };

    const listeners = new Map<string, Set<(ev: any) => void>>();
    const bodyAttrs = new Map<string, string>([
      ["data-refflow-item-id", "205"],
      ["data-refflow-type", "References"]
    ]);
    const sectionAttrs = new Map<string, string>([
      ["data-pane", "refflow@groele.github.io-refflow-references"]
    ]);
    const collapsible = { open: false, querySelector: () => body };
    const body: any = {
      _cards: {},
      references: [],
      isConnected: true,
      getAttribute: (k: string) => bodyAttrs.get(k) ?? null,
      setAttribute: (k: string, v: string) => bodyAttrs.set(k, v),
      removeAttribute: (k: string) => bodyAttrs.delete(k),
      hasAttribute: (k: string) => bodyAttrs.has(k),
      ownerDocument: { defaultView: {} }
    };
    const section: any = {
      item,
      localName: "item-pane-custom-section",
      isConnected: true,
      getAttribute: (k: string) => sectionAttrs.get(k) ?? null,
      setAttribute: (k: string, v: string) => sectionAttrs.set(k, v),
      removeAttribute: (k: string) => sectionAttrs.delete(k),
      querySelector: (sel: string) => {
        if (sel === "collapsible-section") return collapsible;
        if (sel === '[data-type="body"]') return body;
        return null;
      },
      closest: () => null
    };
    const rail = { container: { getEnabledPane: (id: string) => sectionAttrs.get("data-pane") === id ? section : null } };
    const sidenavButton = {
      getAttribute: (k: string) => k === "data-pane" ? sectionAttrs.get("data-pane") : null,
      hasAttribute: () => false,
      closest: (selector: string) => selector === "item-pane-sidenav" ? rail : sidenavButton
    };
    const doc: any = {
      defaultView: {},
      addEventListener: (type: string, fn: (ev: any) => void, opts?: { signal?: AbortSignal }) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(fn);
        opts?.signal?.addEventListener("abort", () => listeners.get(type)?.delete(fn), { once: true });
      }
    };
    body.ownerDocument = doc;

    const ac = new AbortController();
    bindReferenceSidenavClick(views, doc, ac.signal);
    const emitClick = (button = 0) => {
      const ev = { type: "click", button, detail: 1, target: sidenavButton };
      for (const fn of listeners.get("click") || []) fn(ev);
    };

    // Right-click must not trigger fetch
    emitClick(2);
    assert.equal(refreshCalls.length, 0);
    assert.equal(collapsible.open, false);

    // Left-click opens collapsible section and triggers non-cacheOnly fetch
    emitClick(0);
    assert.equal(collapsible.open, true);
    assert.deepEqual(refreshCalls, [{ itemID: 205, cacheOnly: false }]);

    // If references are already loaded for current type, subsequent sidenav click does not re-fetch API
    body.references = [{ title: "Loaded" }];
    bodyAttrs.set("data-refflow-result-type", "References");
    emitClick(0);
    assert.equal(refreshCalls.length, 1);

    // Abort disconnects listener cleanly
    ac.abort();
    body.references = [];
    emitClick(0);
    assert.equal(refreshCalls.length, 1);
  } finally {
    z.Items = origItems;
  }
});

test("registerReferenceItemPane only loads local cache on item selection even when autoRefresh is true", async () => {
  const z: any = Zotero;
  const origPaneMgr = z.ItemPaneManager;
  const origGet = z.Prefs.get;
  const origTypeName = z.ItemTypes.getName;

  let registeredConfig: any;
  z.ItemPaneManager = {
    registerSection: (cfg: any) => {
      registeredConfig = cfg;
      return cfg.paneID;
    }
  };
  let autoRefresh = false;
  z.Prefs.get = (key: string) => {
    if (key === "refflow.autoRefresh") return autoRefresh;
    if (key === "refflow.notAutoRefreshItemTypes") return "book, letter, note";
    return origGet(key);
  };
  z.ItemTypes.getName = () => "journalArticle";

  try {
    const calls: Array<{ itemID: number; cacheOnly: boolean }> = [];
    const views: any = {
      isDisposed: () => false,
      getPanes: () => new Set(),
      attachDocument: () => {},
      referenceTasks: { invalidate: () => {} },
      getPendingImports: () => new WeakMap(),
      refreshReferences: async (_panel: any, _local: boolean, _page: boolean, _toggle: boolean, item: any, _reader: any, cacheOnly = false) => {
        calls.push({ itemID: item.id, cacheOnly });
      }
    };

    const id = registerReferenceItemPane(views);
    assert.ok(id);

    const bodyAttrs = new Map<string, string>();
    const body: any = {
      isConnected: true,
      _cards: { clear: () => {} },
      references: [],
      getAttribute: (k: string) => bodyAttrs.get(k) ?? null,
      setAttribute: (k: string, v: string) => bodyAttrs.set(k, v),
      removeAttribute: (k: string) => bodyAttrs.delete(k),
      hasAttribute: (k: string) => bodyAttrs.has(k),
      querySelector: () => null,
      querySelectorAll: () => [],
      closest: () => null
    };

    const item1 = mockItem(301);
    registeredConfig.onItemChange({ body, item: item1 });
    await registeredConfig.onAsyncRender({ body, item: item1 });

    assert.deepEqual(calls, []);
    autoRefresh = true;
    await registeredConfig.onAsyncRender({ body, item: item1 });

    // Only cacheOnly: true was invoked — zero API requests triggered on item selection
    assert.deepEqual(calls, [{ itemID: 301, cacheOnly: true }]);

    // If sidenav requested a fetch before async render, onAsyncRender honors it with cacheOnly: false
    const item2 = mockItem(302);
    registeredConfig.onItemChange({ body, item: item2 });
    bodyAttrs.set("data-refflow-fetch-requested", "302");
    await registeredConfig.onAsyncRender({ body, item: item2 });

    assert.deepEqual(calls, [
      { itemID: 301, cacheOnly: true },
      { itemID: 302, cacheOnly: true },
      { itemID: 302, cacheOnly: false }
    ]);
  } finally {
    z.ItemPaneManager = origPaneMgr;
    z.Prefs.get = origGet;
    z.ItemTypes.getName = origTypeName;
  }
});
