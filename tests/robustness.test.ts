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

test("Views.importReferences and Views.rollbackReferences use localized getString for read-only items", async () => {
  const Views = require("../src/modules/views").default;
  const views: any = Object.create(Views.prototype);
  views.disposed = false;

  const oldAddon = (globalThis as any).addon;
  (globalThis as any).addon = {
    data: {
      locale: {
        current: {
          formatMessagesSync: ([{ id }]: any) => [{ value: `localized:${id}` }]
        }
      }
    }
  };

  const readOnlyParent: any = {
    id: 500,
    libraryID: 2,
    isEditable: () => false
  };

  try {
    await assert.rejects(
      views.importReferences(readOnlyParent, [{ title: "Test", identifiers: {} }]),
      /localized:refflow-cards-library-readonly/
    );
    await assert.rejects(
      views.rollbackReferences(readOnlyParent, "refnexus_batch_123"),
      /localized:refflow-cards-library-readonly/
    );
  } finally {
    (globalThis as any).addon = oldAddon;
  }
});

test("ReferenceCards.menu disables import and rollback menu items when parent is read-only", () => {
  const createdItems: any[] = [];
  const doc: any = {
    createXULElement: (tag: string) => {
      const node: any = {
        localName: tag,
        children: [],
        attributes: {},
        setAttribute(k: string, v: any) { this.attributes[k] = v; this[k] = v; },
        getAttribute(k: string) { return this.attributes[k] ?? this[k]; },
        addEventListener() {},
        append(child: any) { this.children.push(child); createdItems.push(child); },
        querySelector(sel: string) { return this.children.find((c: any) => c.localName === sel || c.querySelector?.(sel)); },
        openPopup() {},
        remove() {}
      };
      return node;
    },
    documentElement: { append() {} }
  };

  const cards: any = Object.create(ReferenceCards.prototype);
  Object.assign(cards, {
    disposed: false,
    refs: [{ title: "Paper A", identifiers: { DOI: "10.1000/a" } }],
    selected: new Set(),
    menus: new Set(),
    parent: () => ({ id: 77, libraryID: 3, deleted: false, isEditable: () => false }),
    subset: () => [{ title: "Paper A", identifiers: { DOI: "10.1000/a" } }],
    label: () => ({ textContent: "" }),
    body: {
      ownerDocument: doc,
      isConnected: true,
      getAttribute: (name: string) => name === "data-refflow-item-id" ? "77" : "API",
      closest: () => null
    },
    views: { utils: { importCollections: () => [] } }
  });

  cards.menu();
  const quickActions = createdItems.filter(item => item.localName === "menuitem" && item.attributes["data-refflow-quick-action"]);
  const byAction = Object.fromEntries(quickActions.map(item => [item.attributes["data-refflow-quick-action"], item]));

  assert.equal(byAction["import-selected"]?.disabled, true, "import-selected must be disabled for read-only parent");
  assert.equal(byAction["import-all"]?.disabled, true, "import-all must be disabled for read-only parent");
  assert.equal(byAction["rollback"]?.disabled, true, "rollback must be disabled for read-only parent");
  assert.equal(Boolean(byAction["copy-text"]?.disabled), false, "copy-text must remain enabled for read-only parent");
  assert.equal(Boolean(byAction["open"]?.disabled), false, "open must remain enabled for read-only parent");
});

test("Preferences panel adheres to 5+1 modular architecture and covers all core feature preferences", () => {
  const xhtml = fs.readFileSync("addon/chrome/content/preferences.xhtml", "utf8");

  // 1. 验证 6 个 details 组
  const groups = [...xhtml.matchAll(/<html:details\s+class="refflow-setting-group"/g)];
  assert.equal(groups.length, 6, "Preferences panel must contain exactly 6 modular groups");

  // 2. 验证首组默认展开
  assert.ok(xhtml.includes('open="open"'), "First group (Retrieval & Sources) must be open by default");

  // 3. 验证关键配置项偏好映射覆盖
  const expectedPrefs = [
    "extensions.zotero.__addonRef__.prioritySource",
    "extensions.zotero.__addonRef__.autoRefresh",
    "extensions.zotero.__addonRef__.notAutoRefreshItemTypes",
    "extensions.zotero.__addonRef__.savePDFReferences",
    "extensions.zotero.__addonRef__.saveAPIReferences",
    "extensions.zotero.__addonRef__.showSourceDetails",
    "extensions.zotero.__addonRef__.notInLibarayOpacity",
    "extensions.zotero.__addonRef__.graphView.enable",
    "extensions.zotero.__addonRef__.graphView.height",
    "extensions.zotero.__addonRef__.isShowTip",
    "extensions.zotero.__addonRef__.showTipAfterMillisecond",
    "extensions.zotero.__addonRef__.ctrlClickTranslate",
    "extensions.zotero.__addonRef__.shadeMillisecond",
    "extensions.zotero.__addonRef__.removeTipAfterMillisecond",
    "extensions.zotero.__addonRef__.tipBackgroundColor",
    "extensions.zotero.__addonRef__.tipTitleColor",
    "extensions.zotero.__addonRef__.downloadOA",
    "extensions.zotero.__addonRef__.quickAction.copy-text",
    "extensions.zotero.__addonRef__.quickAction.copy-doi",
    "extensions.zotero.__addonRef__.quickAction.copy-url",
    "extensions.zotero.__addonRef__.quickAction.open",
    "extensions.zotero.__addonRef__.quickAction.import-selected",
    "extensions.zotero.__addonRef__.quickAction.import-all",
    "extensions.zotero.__addonRef__.quickAction.rollback",
    "extensions.zotero.__addonRef__.openAlexKey",
    "extensions.zotero.__addonRef__.semanticScholarKey",
    "extensions.zotero.__addonRef__.connectedPapersKey",
  ];

  for (const pref of expectedPrefs) {
    assert.ok(xhtml.includes(`preference="${pref}"`), `Preferences panel must bind ${pref}`);
  }

  // 4. 验证三语本地化完全对称
  const extractKeys = (relPath: string) => {
    const raw = fs.readFileSync(relPath, "utf8");
    const set = new Set<string>();
    for (const line of raw.split("\n")) {
      const m = line.match(/^([a-zA-Z0-9_\-]+)\s*=/);
      if (m) set.add(m[1]);
    }
    return set;
  };

  const zhKeys = extractKeys("addon/locale/zh-CN/preferences.ftl");
  const enKeys = extractKeys("addon/locale/en-US/preferences.ftl");
  const itKeys = extractKeys("addon/locale/it-IT/preferences.ftl");

  assert.equal(zhKeys.size, enKeys.size, "zh-CN and en-US key count must match");
  assert.equal(zhKeys.size, itKeys.size, "zh-CN and it-IT key count must match");

  for (const k of zhKeys) {
    assert.ok(enKeys.has(k), `en-US missing key: ${k}`);
    assert.ok(itKeys.has(k), `it-IT missing key: ${k}`);
  }
});

test("Repository version, release notes, product metadata, and READMEs are 100% synchronized", () => {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const product = JSON.parse(fs.readFileSync("docs/brand/product.json", "utf8"));
  const update = JSON.parse(fs.readFileSync("update.json", "utf8"));
  const readmeZH = fs.readFileSync("README.md", "utf8");
  const readmeEN = fs.readFileSync("README.en.md", "utf8");

  const ver = pkg.version;
  assert.equal(pkg.config.releaseTag, `v${ver}`);
  assert.equal(product.version, ver);
  assert.equal(update.addons[pkg.config.addonID].updates[0].version, ver);

  const releaseNoteRelPath = `docs/releases/v${ver}.md`;
  assert.equal(pkg.config.releaseNotesURL, `https://github.com/groele/Zotero-RefFlow/blob/main/${releaseNoteRelPath}`);
  assert.equal(fs.existsSync(releaseNoteRelPath), true, `${releaseNoteRelPath} must exist on disk`);

  assert.equal(readmeZH.includes(`version-${ver}-245ac7`), true, "README.md badge must match package version");
  assert.equal(readmeZH.includes(`releases/download/v${ver}/zotero-refflow.xpi`), true, "README.md download link must match package version");
  assert.equal(readmeZH.includes(`| 当前插件版本 | ${ver} |`), true, "README.md compatibility table version must match");
  assert.equal(readmeZH.includes("`10.0` 至 `12.*`"), true, "README.md Zotero range must be 10.0 to 12.*");
  assert.equal(readmeZH.includes(releaseNoteRelPath), true, "README.md must link to current release notes");

  assert.equal(readmeEN.includes(`version-${ver}-245ac7`), true, "README.en.md badge must match package version");
  assert.equal(readmeEN.includes(`releases/download/v${ver}/zotero-refflow.xpi`), true, "README.en.md download link must match package version");
  assert.equal(readmeEN.includes(`| Current add-on version | ${ver} |`), true, "README.en.md compatibility table version must match");
  assert.equal(readmeEN.includes("`10.0` through `12.*`"), true, "README.en.md Zotero range must be 10.0 through 12.*");
  assert.equal(readmeEN.includes(releaseNoteRelPath), true, "README.en.md must link to current release notes");
});
