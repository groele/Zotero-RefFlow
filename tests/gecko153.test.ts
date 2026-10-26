import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import Views from "../src/modules/views";
import ConnectedPapers from "../src/modules/connectedpapers";
import ReferenceCards from "../src/modules/referenceCards";
import { registerPrefs } from "../src/modules/prefs";
import { gecko153CompatibilityPlugin } from "../scripts/gecko153-build.mjs";

const prefsCode = fs.readFileSync("addon/chrome/content/scripts/preferences.js", "utf8")
  .replaceAll("__addonRef__", "refflow").replaceAll("__addonInstance__", "ZoteroRefFlow");
const bootstrapCode = fs.readFileSync("addon/bootstrap.js", "utf8")
  .replaceAll("__addonRef__", "refflow").replaceAll("__addonInstance__", "ZoteroRefFlow");
const freeze = "Object.freeze(Array.prototype); Object.freeze(JSON); Object.freeze(Promise); Object.freeze(Object.prototype);";
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};

class Target {
  listeners = new Map<string, Map<Function, unknown>>();
  id = "";
  addEventListener(type: string, fn: Function, capture?: unknown) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Map());
    this.listeners.get(type)!.set(fn, capture);
  }
  removeEventListener(type: string, fn: Function) { this.listeners.get(type)?.delete(fn); }
  dispatch(type: string, target: any = this, extra: any = {}) {
    const event = { target, button: 0, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, ...extra };
    for (const fn of this.listeners.get(type)?.keys() || []) fn(event);
    return event;
  }
  count(type: string) { return this.listeners.get(type)?.size || 0; }
}

function preferenceHarness(existing = false) {
  let root: any = new Target();root.id = "zotero-prefpane-refflow";
  const link: any = { href: "https://example.org/project", closest: () => link };
  root.contains = (node: any) => node === link;
  const document: any = new Target(), window = new Target();
  let inserted = existing, loads = 0;
  document.getElementById = () => inserted ? root : null;
  const launched: string[] = [], errors: unknown[] = [];
  const owner = { data: { alive: true, preferenceCleanups: new Set<Function>(), prefs: { window } },
    hooks: { onPrefsEvent: () => { loads++; } } };
  const context = vm.createContext({ document, window,
    Zotero: { ZoteroRefFlow: owner, launchURL: (url: string) => launched.push(url), logError: (e: unknown) => errors.push(e) } });
  vm.runInContext(freeze, context);vm.runInContext(prefsCode, context);
  return { context, document, window, owner, root, link, launched, errors,
    insert: () => { inserted = true;document.dispatch("load", root); }, get loads() { return loads; } };
}

test("preferences initialize after fragment insertion and non-bubbling load only once", async () => {
  const h = preferenceHarness();assert.equal(h.root.count("click"), 0);
  assert.equal([...h.document.listeners.get("load")!.values()][0], true);
  h.document.dispatch("load", { id: "another-plugin" });h.insert();h.insert();await tick();
  assert.equal(h.loads, 1);assert.equal(h.root.count("click"), 1);
  const event = h.root.dispatch("click", h.link);assert.equal(event.defaultPrevented, true);
  assert.deepEqual(h.launched, [h.link.href]);assert.deepEqual(h.errors, []);
});

test("preferences support an already-inserted root and keep separate windows independent", async () => {
  const a = preferenceHarness(true), b = preferenceHarness(true);await tick();
  assert.equal(a.loads, 1);assert.equal(b.loads, 1);
  a.window.dispatch("unload");
  assert.equal(a.owner.data.preferenceCleanups.size, 0);assert.equal(a.document.count("load"), 0);
  b.root.dispatch("click", b.link);assert.equal(b.launched.length, 1);
  b.document.dispatch("unload", b.root);assert.equal(b.root.count("click"), 0);
});

test("disable releases preference listeners before a queued initialization can run", async () => {
  const h = preferenceHarness();h.insert();h.owner.data.alive = false;
  for (const dispose of [...h.owner.data.preferenceCleanups]) dispose();
  h.insert();h.root.dispatch("click", h.link);await tick();
  assert.equal(h.loads, 0);assert.equal(h.launched.length, 0);
  assert.equal(h.document.count("load"), 0);assert.equal(h.document.count("unload"), 0);
  assert.equal(h.window.count("unload"), 0);assert.equal(h.root.count("click"), 0);
});

test("preferences do not intercept another plugin's links or non-primary clicks", () => {
  const h = preferenceHarness(true);
  assert.equal(h.root.dispatch("click", { closest: () => ({ href: "https://other.org" }) }).defaultPrevented, false);
  assert.equal(h.root.dispatch("click", h.link, { button: 2 }).defaultPrevented, false);
  assert.equal(h.launched.length, 0);
});

function bootstrapHarness(options: { initialization?: Promise<void>; failLoad?: boolean; failShutdown?: boolean; startup?: Promise<void> } = {}) {
  const steps: string[] = [], errors: unknown[] = [];
  const instance = { data: { alive: true }, views: { storage: { dispose: () => steps.push("storage") } },
    hooks: { onShutdown: () => { steps.push("shutdown");if (options.failShutdown) throw new Error("host unregister failed"); } } };
  const manager = { registerChrome: () => { steps.push("register");return { destruct: () => steps.push("chrome") }; } };
  const context: any = vm.createContext({ APP_SHUTDOWN: 2,
    Zotero: { initializationPromise: options.initialization || Promise.resolve(), logError: (e: unknown) => errors.push(e) },
    PathUtils: {}, AbortController,
    Components: { interfaces: {}, utils: { importGlobalProperties: () => {} }, classes: {
      "@mozilla.org/addons/addon-manager-startup;1": { getService: () => manager },
      "@mozilla.org/intl/stringbundle;1": { getService: () => ({ flushBundles: () => steps.push("bundles") }) } } },
    ChromeUtils: { importESModule: () => ({ setTimeout, clearTimeout }) },
    Services: { io: { newURI: (url: string) => url }, scriptloader: { loadSubScript: (_url: string, ctx: any) => {
      ctx.addon = instance;context.Zotero.ZoteroRefFlow = instance;
      ctx.startupPromise = options.startup || Promise.resolve();steps.push("script");
      if (options.failLoad) throw new Error("script failed");
    } } } });
  vm.runInContext(freeze, context);vm.runInContext(bootstrapCode, context);
  return { context, steps, errors, instance };
}
const startupData = { id: "refflow@groele.github.io", version: "11.0.3-gecko153.1", rootURI: "file:///plugin/" };

test("bootstrap cancellation while awaiting Zotero initialization cannot register late resources", async () => {
  const gate = deferred(), h = bootstrapHarness({ initialization: gate.promise });
  const pending = h.context.startup(startupData, 1);await h.context.shutdown(startupData, 1);
  gate.resolve();await pending;assert.equal(h.steps.includes("register"), false);
});

test("bootstrap script failure releases partial hooks and chrome in a frozen sandbox", async () => {
  const h = bootstrapHarness({ failLoad: true });
  await assert.rejects(h.context.startup(startupData, 1), /script failed/);
  assert.deepEqual(h.steps, ["register", "script", "shutdown", "chrome", "bundles"]);
  assert.equal(vm.runInContext("Object.isFrozen(Array.prototype) && Object.isFrozen(JSON) && Object.isFrozen(Promise)", h.context), true);
});

test("shutdown hook failure does not prevent chrome destruction or repeated shutdown", async () => {
  const h = bootstrapHarness({ failShutdown: true });await h.context.startup(startupData, 1);
  await h.context.shutdown(startupData, 1);await h.context.shutdown(startupData, 1);
  assert.equal(h.steps.filter(s => s === "chrome").length, 1);assert.equal(h.errors.length, 2);
  assert.equal(h.instance.data.alive, false);
});

test("a rejected asynchronous startup receives the same partial-resource cleanup", async () => {
  const gate = deferred(), h = bootstrapHarness({ startup: gate.promise.then(() => { throw new Error("UI startup failed"); }) });
  const pending = h.context.startup(startupData, 1);await tick();gate.resolve();
  await assert.rejects(pending, /UI startup failed/);assert.equal(h.steps.includes("chrome"), true);
});

test("native preferences registration explicitly uses the XUL namespace and external script", async () => {
  const z: any = Zotero, original = z.PreferencePanes, originalURI = (globalThis as any).rootURI;
  let options: any;z.PreferencePanes = { register: (value: any) => { options = value; } };
  (globalThis as any).rootURI = "file:///plugin/";
  try { await registerPrefs();assert.equal(options.defaultXUL, true);
    assert.deepEqual(options.scripts, ["file:///plugin/chrome/content/scripts/preferences.js"]);
    assert.doesNotMatch(fs.readFileSync("addon/chrome/content/preferences.xhtml", "utf8"), /\son(?:load|click|command)\s*=/i);
  } finally { z.PreferencePanes = original;(globalThis as any).rootURI = originalURI; }
});

test("view shutdown continues after host unregister and storage failures, then remains idempotent", async () => {
  const z: any = Zotero, saved = { logError: z.logError, Notifier: z.Notifier, ItemPaneManager: z.ItemPaneManager, getMainWindows: z.getMainWindows };
  const steps: string[] = [], errors: unknown[] = [];
  z.logError = (error: unknown) => errors.push(error);
  z.Notifier = { unregisterObserver: () => { steps.push("notifier");throw new Error("notifier failure"); } };
  z.ItemPaneManager = { unregisterSection: () => { steps.push("pane");throw new Error("pane failure"); } };
  const doc = { getElementById: () => ({ remove: () => steps.push("style") }), l10n: { removeResourceIds: () => steps.push("fluent") } };
  z.getMainWindows = () => [{ document: doc }];
  const views: any = Object.create(Views.prototype);
  Object.assign(views, { disposed: false, menus: new Set(), panes: new Set([{ _cards: { dispose: () => steps.push("cards") } }]), tips: new Map(),
    localizationDocuments: new Set([doc]), notifierID: "notifier", paneID: "pane", referenceTasks: { dispose: () => steps.push("tasks") },
    utils: { API: { requests: { dispose: () => steps.push("requests") }, publisherReferences: { dispose: () => steps.push("publisher") } } },
    storage: { dispose: async () => { steps.push("storage");throw new Error("storage failure"); } } });
  try { await views.shutdown();await views.shutdown();
    assert.deepEqual(steps, ["cards", "tasks", "requests", "publisher", "notifier", "pane", "storage", "style", "fluent"]);
    assert.equal(errors.length, 3);
  } finally { Object.assign(z, saved); }
});

test("graph shutdown releases listeners and DOM even if one host cleanup throws", () => {
  const z: any = Zotero, original = z.logError;const steps: string[] = [];
  z.logError = () => {};const graph: any = Object.create(ConnectedPapers.prototype);
  Object.assign(graph, { disposed: false, requests: { dispose: () => { throw new Error("request cleanup failure"); } },
    win: { ZoteroPane: { itemsView: { onSelect: { removeListener: () => steps.push("select") } } } },
    cleanup: [() => { throw new Error("listener failed"); }, () => steps.push("listener")],
    doc: { getElementById: () => ({ remove: () => steps.push("dom") }) } });
  try { graph.shutdown();graph.shutdown();assert.deepEqual(steps, ["select", "listener", "dom", "dom"]); }
  finally { z.logError = original; }
});

test("hook startup stays cancelled after UI readiness resolves and a cleanup failure does not retain the registry", async () => {
  const { build } = await import("esbuild");
  const code = (await build({ entryPoints: ["src/hooks.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "RefFlowHooks", plugins: [gecko153CompatibilityPlugin()] })).outputFiles[0].text;
  const gate = deferred(), errors: unknown[] = [];let windowsQueried = 0, toolkitDisposed = false, dialogClosed = false;
  const owner: any = { data: { alive: true, preferenceCleanups: new Set([() => { throw new Error("preferences cleanup failed"); }]),
    dialog: { window: { close: () => { dialogClosed = true; } } } } };
  const context: any = vm.createContext({ addon: owner, rootURI: "file:///plugin/", __env__: "production",
    Zotero: { initializationPromise: Promise.resolve(), unlockPromise: Promise.resolve(), uiReadyPromise: gate.promise,
      ZoteroRefFlow: owner, logError: (e: unknown) => errors.push(e),
      getMainWindows: () => { windowsQueried++;return []; }, PreferencePanes: { unregister: () => { throw new Error("host unregister failed"); } } },
    ztoolkit: { unregisterAll: () => { toolkitDisposed = true; } } });
  vm.runInContext(freeze, context);vm.runInContext(code, context);
  const hooks = context.RefFlowHooks.default;
  const pending = hooks.onStartup();await hooks.onShutdown();gate.resolve();await pending;
  assert.equal(windowsQueried, 0);assert.equal(toolkitDisposed, true);assert.equal(dialogClosed, true);
  assert.equal(context.Zotero.ZoteroRefFlow, undefined);assert.equal(owner.data.preferenceCleanups.size, 0);assert.equal(errors.length, 2);
});

test("bundled D3 HSL parsing and serialization work with frozen builtins without changing them", async () => {
  const { build } = await import("esbuild");
  const code = (await build({ stdin: { contents: 'export {hsl} from "d3";', resolveDir: process.cwd() }, bundle: true, write: false,
    platform: "browser", format: "iife", globalName: "Colors", plugins: [gecko153CompatibilityPlugin()] })).outputFiles[0].text;
  const sandbox: any = vm.createContext({});vm.runInContext(freeze, sandbox);
  const inherited = vm.runInContext("Object.prototype.toString", sandbox);
  vm.runInContext(code, sandbox);
  const color = sandbox.Colors.hsl("#c22727"), sample = sandbox.Colors.hsl("rgb(30, 60, 90)");
  assert.ok(Math.abs(color.h) < 0.001);assert.ok(color.s > 0.6);assert.equal(String(color), "rgb(194, 39, 39)");
  sample.h = color.h;sample.s = (sample.s + 2 * color.s) / 3;
  assert.match(String(sample), /^rgb\(/);
  assert.equal(vm.runInContext("Object.prototype.toString", sandbox), inherited);
  assert.equal(vm.runInContext("Object.isFrozen(Object.prototype)", sandbox), true);
});

test("menu command catches a synchronous action failure instead of leaking an event rejection", async () => {
  const z: any = Zotero, saved = { Items: z.Items, log: (ztoolkit as any).log, addon: (globalThis as any).addon };
  const entries: any[] = [], logged: unknown[] = [];let label = { textContent: "" };
  z.Items = { get: () => ({ id: 1 }) };(ztoolkit as any).log = (error: unknown) => logged.push(error);
  (globalThis as any).addon = { data: { locale: { current: { formatMessagesSync: ([{ id }]: any) => [{ value: id }] } } } };
  const doc: any = { createXULElement: () => {
    const node: any = new Target();node.setAttribute = (name: string, value: any) => { node[name] = value; };
    node.append = (entry: any) => entries.push(entry);node.openPopup = () => {};return node;
  }, documentElement: { append: () => {} } };
  const cards: any = Object.create(ReferenceCards.prototype);
  Object.assign(cards, { refs: [], menus: new Set(), parent: () => ({ id: 1 }), subset: () => [], label: () => label,
    body: { ownerDocument: doc, isConnected:true, getAttribute: (name:string) => name==='data-refflow-item-id'?'1':'API', closest: () => null },
    views: { utils: { importCollections:()=>[], copyText: () => { throw new Error("clipboard failed synchronously"); } } } });
  try { cards.menu();entries[0].dispatch("command");await tick();
    assert.match(label.textContent, /clipboard failed synchronously/);assert.equal(logged.length, 1);
    const checks = entries.filter(entry => entry.type === "checkbox");
    assert.equal(checks.length, 8);assert.equal(checks.filter(entry => entry.checked).length, 1);
    assert.equal(checks.every(entry => typeof entry.checked === "boolean"), true);
    entries[0].dispatch("command");cards.disposed = true;await tick();assert.equal(logged.length, 1);
  } finally { z.Items = saved.Items;(ztoolkit as any).log = saved.log;(globalThis as any).addon = saved.addon; }
});

test("card disposal removes search, keyboard and context listeners plus live popups", () => {
  const search: any = new Target();search.value = "";
  const grid: any = new Target();grid.setAttribute = () => {};grid.replaceChildren = () => {};
  const cards: any = new ReferenceCards({} as any, {} as any, grid, search);
  let removed = 0;cards.menus.add({ remove: () => { removed++; } });
  assert.equal(search.count("input"), 1);assert.equal(grid.count("contextmenu"), 1);
  cards.dispose();cards.dispose();cards.menu();
  assert.equal(search.count("input"), 0);assert.equal(search.count("keydown"), 0);
  assert.equal(grid.count("contextmenu"), 0);assert.equal(cards.menus.size, 0);assert.equal(removed, 1);
});
