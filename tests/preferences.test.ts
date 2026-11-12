import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bindCachePreferences } from "../src/modules/prefs";
import PDF from "../src/modules/pdf";

class FakeElement {
  id = "";
  tagName = "INPUT";
  type = "text";
  value = "";
  checked = false;
  disabled = false;
  textContent: string | null = "";
  title = "";
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  listeners = new Map<string, Set<Function>>();
  children: FakeElement[] = [];

  constructor(tagName = "INPUT", opts: Partial<FakeElement> = {}) {
    this.tagName = tagName;
    Object.assign(this, opts);
  }
  get validity() { return { valid: true }; }
  get valueAsNumber() { return Number(this.value); }
  setAttribute(k: string, v: string) {
    this.attributes.set(k, v);
    if (k === "id") this.id = v;
  }
  getAttribute(k: string) { return this.attributes.get(k) ?? null; }
  toggleAttribute(k: string, force?: boolean) {
    const next = force === undefined ? !this.attributes.has(k) : force;
    if (next) this.attributes.set(k, "");
    else this.attributes.delete(k);
    if (k === "disabled") this.disabled = next;
    if (k === "checked") this.checked = next;
    return next;
  }
  addEventListener(type: string, fn: Function) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: Function) {
    this.listeners.get(type)?.delete(fn);
  }
  dispatchEvent(ev: { type: string }) {
    for (const fn of this.listeners.get(ev.type) || []) fn(ev);
    return true;
  }
  querySelector(sel: string): FakeElement | null {
    return this.querySelectorAll(sel)[0] || null;
  }
  querySelectorAll(sel: string): FakeElement[] {
    if (sel.startsWith("#")) {
      const id = sel.slice(1);
      return this.children.filter(c => c.id === id);
    }
    const attrMatch = sel.match(/^\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]$/);
    if (attrMatch) {
      const [, attr, val] = attrMatch;
      return this.children.filter(c =>
        val === undefined ? c.attributes.has(attr) : c.getAttribute(attr) === val
      );
    }
    return [];
  }
}

function createPrefPaneFixture() {
  const prefStore = new Map<string, any>([
    ["refflow.autoRefresh", false],
    ["refflow.notAutoRefreshItemTypes", "book, letter, note"],
    ["refflow.isShowTip", true],
    ["refflow.graphView.enable", false],
    ["refflow.graphView.height", "400px"],
    ["refflow.cacheEnabled", true],
    ["refflow.savePDFReferences", true],
    ["refflow.saveAPIReferences", true],
    ["refflow.referenceDays", 30],
    ["refflow.pdfDays", 30],
    ["refflow.neighborhoodDays", 30],
    ["refflow.partialMinutes", 15],
    ["refflow.cacheMaxMiB", 8],
    ["refflow.cacheMaxItems", 250],
    ["refflow.openAlexKey", "secret-oa"],
    ["refflow.semanticScholarKey", "secret-s2"],
    ["refflow.connectedPapersKey", "secret-cp"],
    ["refflow.CNKI.username", "cnki-user"],
    ["refflow.CNKI.password", "cnki-pass"],
  ]);
  const observers = new Map<string, Set<Function>>();
  const z: any = Zotero;
  const savedPrefs = z.Prefs;
  const savedAddon = (globalThis as any).addon;
  (globalThis as any).addon = { data: { preferenceCleanups: new Set() }, views: undefined };
  z.Prefs = {
    get: (k: string) => prefStore.get(k),
    set: (k: string, v: any) => {
      prefStore.set(k, v);
      for (const fn of observers.get(k) || []) fn();
    },
    registerObserver: (k: string, fn: Function) => {
      if (!observers.has(k)) observers.set(k, new Set());
      observers.get(k)!.add(fn);
      return `${k}::${observers.get(k)!.size}`;
    },
    unregisterObserver: () => {},
  };

  const root = new FakeElement("VBOX", { id: "zotero-prefpane-refflow" });
  const add = (tag: string, id: string, opts: Partial<FakeElement> = {}, pref?: string) => {
    const el = new FakeElement(tag, { id, ...opts });
    if (pref) el.setAttribute("preference", `extensions.zotero.refflow.${pref}`);
    root.children.push(el);
    return el;
  };

  const els = {
    autoRefresh: add("checkbox", "refflow-auto-refresh", { checked: false }, "autoRefresh"),
    notAutoTypes: add("INPUT", "refflow-not-auto-refresh-item-types", { value: "book, letter, note" }, "notAutoRefreshItemTypes"),
    graphEnable: add("checkbox", "refflow-graph-view-enable", { checked: false }, "graphView.enable"),
    graphHeight: add("INPUT", "refflow-graph-view-height", { type: "number", value: "400" }, "graphView.height"),
    isShowTip: add("checkbox", "refflow-is-show-tip", { checked: true }, "isShowTip"),
    tipDelay: add("INPUT", "refflow-show-tip-after-millisecond", { type: "number", value: "233" }, "showTipAfterMillisecond"),
    ctrlTranslate: add("checkbox", "refflow-ctrl-click-translate", { checked: true }, "ctrlClickTranslate"),
    tipBgPicker: add("INPUT", "refflow-tip-background-color-picker", { type: "color", value: "#ffffff" }),
    tipBg: add("INPUT", "refflow-tip-background-color", { value: "#ffffff" }, "tipBackgroundColor"),
    tipTitlePicker: add("INPUT", "refflow-tip-title-color-picker", { type: "color", value: "#2270d9" }),
    tipTitle: add("INPUT", "refflow-tip-title-color", { value: "#2270d9" }, "tipTitleColor"),
    tipShade: add("INPUT", "refflow-shade-millisecond", { type: "number", value: "233" }, "shadeMillisecond"),
    tipRemove: add("INPUT", "refflow-remove-tip-after-millisecond", { type: "number", value: "500" }, "removeTipAfterMillisecond"),
    opacity: add("INPUT", "refflow-not-in-library-opacity", { type: "range", value: "1" }, "notInLibarayOpacity"),
    opacityOut: add("OUTPUT", "refflow-not-in-library-opacity-val", {}),
    resetBtn: add("BUTTON", "refflow-reset-defaults", {}),
    resetStatus: add("SPAN", "refflow-reset-status", {}),
  };

  const win: any = {
    AbortController,
    document: {
      getElementById: (id: string) => (id === root.id ? root : root.children.find(c => c.id === id) || null),
    },
    addEventListener: () => {},
  };

  const cleanup = () => {
    z.Prefs = savedPrefs;
    (globalThis as any).addon = savedAddon;
  };
  return { root, win, els, prefStore, cleanup };
}

test("bindCachePreferences links autoRefresh, graphView.enable, isShowTip and reset button", () => {
  const f = createPrefPaneFixture();
  try {
    bindCachePreferences(f.win);

    // Initial dependency states
    assert.equal(f.els.notAutoTypes.disabled, true);
    assert.equal(f.els.graphHeight.disabled, true);
    assert.equal(f.els.tipDelay.disabled, false);
    assert.equal(f.els.ctrlTranslate.disabled, false);

    // Interactive command toggle enables autoRefresh & graphHeight
    f.els.autoRefresh.checked = true;
    f.els.autoRefresh.dispatchEvent({ type: "command" });
    assert.equal(f.els.notAutoTypes.disabled, false);

    f.els.graphEnable.checked = true;
    f.els.graphEnable.dispatchEvent({ type: "command" });
    assert.equal(f.els.graphHeight.disabled, false);

    // Pref observer disables all 8 tip children when isShowTip turns false
    f.prefStore.set("refflow.isShowTip", false);
    Zotero.Prefs.set("refflow.isShowTip", false);
    for (const child of [f.els.tipDelay, f.els.ctrlTranslate, f.els.tipBgPicker, f.els.tipBg, f.els.tipTitlePicker, f.els.tipTitle, f.els.tipShade, f.els.tipRemove]) {
      assert.equal(child.disabled, true, `${child.id} should disable when isShowTip is false`);
    }

    // Mutate behavioral preferences then click Reset
    f.els.notAutoTypes.value = "custom";
    f.els.opacity.value = "0.5";
    f.els.opacity.dispatchEvent({ type: "input" });
    assert.equal(f.els.opacityOut.getAttribute("data-l10n-args"), JSON.stringify({ percent: 50 }));

    f.els.resetBtn.dispatchEvent({ type: "click" });
    assert.equal(f.prefStore.get("refflow.autoRefresh"), false);
    assert.equal(f.prefStore.get("refflow.graphView.enable"), false);
    assert.equal(f.prefStore.get("refflow.isShowTip"), true);
    assert.equal(f.prefStore.get("refflow.notInLibarayOpacity"), "1");
    assert.equal(f.els.notAutoTypes.value, "book, letter, note");
    assert.equal(f.els.graphHeight.value, "400");
    assert.equal(f.els.notAutoTypes.disabled, true);
    assert.equal(f.els.graphHeight.disabled, true);
    assert.equal(f.els.tipDelay.disabled, false);
    assert.equal(f.els.opacityOut.getAttribute("data-l10n-args"), JSON.stringify({ percent: 100 }));
    assert.equal(f.els.resetStatus.getAttribute("data-l10n-id"), "refflow-reset-done");

    // API keys and CNKI credentials must remain untouched
    assert.equal(f.prefStore.get("refflow.openAlexKey"), "secret-oa");
    assert.equal(f.prefStore.get("refflow.semanticScholarKey"), "secret-s2");
    assert.equal(f.prefStore.get("refflow.connectedPapersKey"), "secret-cp");
    assert.equal(f.prefStore.get("refflow.CNKI.username"), "cnki-user");
    assert.equal(f.prefStore.get("refflow.CNKI.password"), "cnki-pass");
  } finally {
    f.cleanup();
  }
});

test("preferences.xhtml contains no hardcoded 100%, px, or API badge literals", () => {
  const xhtml = fs.readFileSync(path.join(process.cwd(), "addon", "chrome", "content", "preferences.xhtml"), "utf8");
  assert.doesNotMatch(xhtml, />100%</);
  assert.doesNotMatch(xhtml, />px</);
  assert.doesNotMatch(xhtml, />API</);
  assert.match(xhtml, /id="__addonRef__-reset-defaults"/);
});

test("PDF.getReferences progress notification uses Fluent addon.ftl keys", async () => {
  const z: any = Zotero;
  const tool: any = ztoolkit;
  const oldProgress = tool.ProgressWindow;
  const oldAddon = (globalThis as any).addon;
  const oldSDT = z.SDT;
  const lines: any[] = [];

  (globalThis as any).addon = {
    data: {
      locale: {
        current: {
          formatMessagesSync([{ id, args }]: Array<{ id: string; args?: Record<string, unknown> }>) {
            if (id === "refflow-pdf-done-title") return [{ value: "LOCALIZED DONE" }];
            if (id === "refflow-pdf-extracted-count") return [{ value: `LOCALIZED COUNT ${args?.count}` }];
            if (id === "refflow-pdf-empty-title") return [{ value: "LOCALIZED EMPTY" }];
            if (id === "refflow-pdf-no-section") return [{ value: "LOCALIZED NONE" }];
            return [];
          },
        },
      },
    },
  };
  tool.ProgressWindow = class {
    constructor(public heading: string) {}
    createLine(line: any) { lines.push({ heading: this.heading, ...line }); return this; }
    show() { return this; }
  };
  z.SDT = {
    getReader: async () => ({
      header: { schemaVersion: "1.2.0" },
      getCatalog: async () => ({ pages: [{ viewRect: [0, 0, 612, 792] }] }),
      getPageBlocks: async () => [],
    }),
  };

  try {
    const pdf = new PDF({ refText2Info: (t: string) => ({ title: t, identifiers: {} }) } as any);
    const attachment = {
      id: 1,
      attachmentContentType: "application/pdf",
      getAttachmentLastPageIndex: () => 0,
    } as any;
    await pdf.getReferences(attachment, false, { notify: true });
    assert.equal(lines.length, 1);
    assert.equal(lines[0].heading, "LOCALIZED EMPTY");
    assert.equal(lines[0].text, "LOCALIZED NONE");
  } finally {
    tool.ProgressWindow = oldProgress;
    z.SDT = oldSDT;
    (globalThis as any).addon = oldAddon;
  }
});
