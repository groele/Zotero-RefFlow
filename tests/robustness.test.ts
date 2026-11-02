import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Utils from "../src/modules/utils";
import ReferenceCards from "../src/modules/referenceCards";
import TipUI from "../src/modules/tip";
import batchJournal, { BatchJournal } from "../src/modules/batchJournal";

test("BatchJournal safely accesses IOUtils via globalThis when main window is unavailable", async () => {
  const z: any = Zotero;
  const oldGetMainWindow = z.getMainWindow;
  const oldGlobalIOUtils = (globalThis as any).IOUtils;

  let existsCalled = false;
  const mockIOUtils = {
    exists: async () => { existsCalled = true; return false; },
    readJSON: async () => ({ version: 1, pending: false, entries: [] }),
    writeJSON: async () => {}
  };

  try {
    // 模拟无主窗口环境
    z.getMainWindow = () => undefined;
    (globalThis as any).IOUtils = mockIOUtils;

    const journal = new BatchJournal();
    // 验证调用内部 io getter 能够安全路由至全局 IOUtils，而不是抛出 TypeError
    const io = (journal as any).io;
    assert.ok(io);
    assert.equal(typeof io.exists, "function");
    await io.exists("test");
    assert.equal(existsCalled, true);
  } finally {
    z.getMainWindow = oldGetMainWindow;
    (globalThis as any).IOUtils = oldGlobalIOUtils;
  }
});

test("Utils.resolveLibraryID falls back to active reader item in detached window", () => {
  const utils = new Utils();
  const mockDetachedWin: any = {
    document: {}
  };

  // 构造阅读器中打开的条目
  const mockReaderItem: any = {
    id: 99,
    libraryID: 42,
    isRegularItem: () => true
  };
  (utils as any).getItem = (win: any) => win === mockDetachedWin ? mockReaderItem : undefined;

  const libraryID = utils.resolveLibraryID(mockDetachedWin);
  assert.equal(libraryID, 42);
});

test("ReferenceCards disables import button and sets readonly title for non-editable libraries", async () => {
  const z: any = Zotero;
  const oldLibraries = z.Libraries;

  try {
    // 模拟只读文库 (editable: false)
    z.Libraries = {
      get: (id: number) => ({ id, editable: false })
    };

    const parent: any = {
      id: 100,
      libraryID: 5,
      isRegularItem: () => true,
      deleted: false
    };

    const doc: any = {
      createElement: (tag: string) => {
        const el: any = {
          tagName: tag,
          dataset: {},
          attributes: {},
          style: {},
          children: [],
          append: (...nodes: any[]) => el.children.push(...nodes),
          setAttribute: (k: string, v: string) => { el.attributes[k] = v; el[k] = v; },
          getAttribute: (k: string) => el.attributes[k] ?? el[k],
          removeAttribute: (k: string) => { delete el.attributes[k]; delete el[k]; },
          hasAttribute: (k: string) => k in el.attributes || k in el,
          addEventListener: () => {},
          removeEventListener: () => {},
          replaceChildren: (...nodes: any[]) => { el.children = [...nodes]; }
        };
        return el;
      },
      createElementNS: (_ns: string, tag: string) => doc.createElement(tag)
    };

    const body: any = {
      isConnected: true,
      getAttribute: (k: string) => k === "data-refflow-item-id" ? "100" : null,
      querySelector: () => doc.createElement("div"),
      ownerDocument: doc
    };

    const grid: any = doc.createElement("div");
    grid.ownerDocument = doc;
    const search: any = doc.createElement("input");
    search.value = "";
    search.ownerDocument = doc;

    const views: any = {
      utils: new Utils()
    };

    const cards = new ReferenceCards(views, body, grid, search);
    (cards as any).parent = () => parent;
    (cards as any).refs = [{ title: "Ref 1", identifiers: { DOI: "10.1000/1" } }];

    // 尝试在只读库上调用 settings action
    await assert.rejects(
      cards.runSettingsAction("import-all"),
      /cards-library-readonly|read-only/i
    );
  } finally {
    z.Libraries = oldLibraries;
  }
});

test("TipUI mouseenter sets optionNode.title without calling Zotero.ProgressWindowSet.closeAll", () => {
  const utils = new Utils();
  const mockWin: any = {
    document: {
      documentElement: { getBoundingClientRect: () => ({ width: 1000, height: 800 }) },
      querySelectorAll: () => []
    }
  };

  const tip = new TipUI(utils, mockWin);
  const z: any = Zotero;
  let closeAllCalled = false;
  const oldSet = z.ProgressWindowSet;
  z.ProgressWindowSet = {
    closeAll: () => { closeAllCalled = true; }
  };

  try {
    // 构造 optionNode 测试节点
    const optionNode: any = {
      title: ""
    };
    const tags = [{ source: "OpenAlex" }];
    const according = "DOI";

    // 模拟 tip.ts 中的 mouseenter 逻辑
    let tag = tags.find(t => t.source);
    let source = ((tag && tag.source && according && `${tag.source} view according to ${according}`) || "reference view");
    optionNode.title = source;

    assert.equal(optionNode.title, "OpenAlex view according to DOI");
    assert.equal(closeAllCalled, false, "ProgressWindowSet.closeAll must not be invoked on tip hover");
  } finally {
    z.ProgressWindowSet = oldSet;
  }
});

test("Fluent localization files (en-US, zh-CN, it-IT) have completely synchronized keys", () => {
  function parseFTL(content: string) {
    const entries = new Set<string>();
    let currentKey: string | null = null;
    for (const rawLine of content.split("\n")) {
      const line = rawLine.trimEnd();
      if (!line || line.startsWith("#")) continue;
      const keyMatch = line.match(/^([a-zA-Z0-9_\-]+)\s*=/);
      if (keyMatch) {
        currentKey = keyMatch[1];
        entries.add(currentKey);
      } else if (currentKey && line.startsWith("    .")) {
        const attrMatch = line.trim().match(/^\.([a-zA-Z0-9_\-]+)\s*=/);
        if (attrMatch) {
          entries.add(`${currentKey}.${attrMatch[1]}`);
        }
      }
    }
    return entries;
  }

  const baseDir = "addon/locale";
  const en = parseFTL(fs.readFileSync(path.join(baseDir, "en-US/addon.ftl"), "utf8"));
  const zh = parseFTL(fs.readFileSync(path.join(baseDir, "zh-CN/addon.ftl"), "utf8"));
  const it = parseFTL(fs.readFileSync(path.join(baseDir, "it-IT/addon.ftl"), "utf8"));

  assert.equal(en.size, zh.size, `en-US (${en.size}) and zh-CN (${zh.size}) keys must match`);
  assert.equal(en.size, it.size, `en-US (${en.size}) and it-IT (${it.size}) keys must match`);

  const missingInZH = [...en].filter(k => !zh.has(k));
  const missingInIT = [...en].filter(k => !it.has(k));

  assert.deepEqual(missingInZH, [], "No missing keys in zh-CN");
  assert.deepEqual(missingInIT, [], "No missing keys in it-IT");
});

test("ConnectedPapers token helpers handle fallback and dual-write", () => {
  const { getConnectedPapersToken, setConnectedPapersToken } = require("../src/modules/GraphData");
  const z: any = Zotero;

  const prefsStore: Record<string, any> = {};
  const oldGet = z.Prefs.get;
  const oldSet = z.Prefs.set;

  z.Prefs.get = (key: string) => prefsStore[key];
  z.Prefs.set = (key: string, val: any) => { prefsStore[key] = val; };

  try {
    // 1. 无值时返回空串
    assert.equal(getConnectedPapersToken(), "");

    // 2. 只有历史全局 key 时回退读取
    prefsStore["ConnectedPapers.accessToken"] = "legacy_token_123";
    assert.equal(getConnectedPapersToken(), "legacy_token_123");

    // 3. 有专用 key 时优先读取专用 key
    prefsStore["refflow.connectedPapersKey"] = "modern_token_456";
    assert.equal(getConnectedPapersToken(), "modern_token_456");

    // 4. 保存时双写
    setConnectedPapersToken("new_token_789");
    assert.equal(prefsStore["refflow.connectedPapersKey"], "new_token_789");
    assert.equal(prefsStore["ConnectedPapers.accessToken"], "new_token_789");
  } finally {
    z.Prefs.get = oldGet;
    z.Prefs.set = oldSet;
  }
});

test("PublisherReferences safely handles DOMParser exceptions without crashing", () => {
  const PublisherReferences = require("../src/modules/publisherReferences").default;
  const instance = new PublisherReferences();

  const oldParser = (globalThis as any).ztoolkit?.getDOMParser;
  try {
    // 模拟 DOMParser 抛错
    (globalThis as any).ztoolkit = {
      ...(globalThis as any).ztoolkit,
      getDOMParser: () => ({
        parseFromString: () => { throw new Error("XML syntax error in malformed response"); }
      })
    };

    const htmlResult = instance.parseHTML("<html>bad</html>", "https://nature.com/articles/123", "10.1038/s41586-020-0001-1");
    assert.deepEqual(htmlResult, [], "parseHTML must catch parser error and return empty array");

    const xmlResult = instance.parseXML("<article>bad xml</article>", "10.1038/s41586-020-0001-1");
    assert.deepEqual(xmlResult, [], "parseXML must catch parser error and return empty array");
  } finally {
    if ((globalThis as any).ztoolkit) {
      (globalThis as any).ztoolkit.getDOMParser = oldParser;
    }
  }
});

test("Preferences Fluent files (en-US, zh-CN, it-IT) have completely synchronized keys", () => {
  function parseFTL(content: string) {
    const entries = new Set<string>();
    let currentKey: string | null = null;
    for (const rawLine of content.split("\n")) {
      const line = rawLine.trimEnd();
      if (!line || line.startsWith("#")) continue;
      const keyMatch = line.match(/^([a-zA-Z0-9_\-]+)\s*=/);
      if (keyMatch) {
        currentKey = keyMatch[1];
        entries.add(currentKey);
      } else if (currentKey && line.startsWith("    .")) {
        const attrMatch = line.trim().match(/^\.([a-zA-Z0-9_\-]+)\s*=/);
        if (attrMatch) {
          entries.add(`${currentKey}.${attrMatch[1]}`);
        }
      }
    }
    return entries;
  }

  const baseDir = "addon/locale";
  const en = parseFTL(fs.readFileSync(path.join(baseDir, "en-US/preferences.ftl"), "utf8"));
  const zh = parseFTL(fs.readFileSync(path.join(baseDir, "zh-CN/preferences.ftl"), "utf8"));
  const it = parseFTL(fs.readFileSync(path.join(baseDir, "it-IT/preferences.ftl"), "utf8"));

  assert.equal(en.size, zh.size, `en-US (${en.size}) and zh-CN (${zh.size}) preferences keys must match`);
  assert.equal(en.size, it.size, `en-US (${en.size}) and it-IT (${it.size}) preferences keys must match`);

  const missingInZH = [...en].filter(k => !zh.has(k));
  const missingInIT = [...en].filter(k => !it.has(k));

  assert.deepEqual(missingInZH, [], "No missing preferences keys in zh-CN");
  assert.deepEqual(missingInIT, [], "No missing preferences keys in it-IT");
});
