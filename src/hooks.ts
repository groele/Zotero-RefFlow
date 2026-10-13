import { config } from "../package.json";
import { registerPrefsScripts, registerPrefs } from "./modules/prefs";
import Views from "./modules/views";
import ConnectedPapers from "./modules/connectedpapers";
import { restoreLegacySidebarLayout } from "./modules/sidebarLayout";
import type Addon from "./addon";
const registry = Zotero as typeof Zotero & Record<string, Addon | undefined>;

const initializedWindows = new WeakSet<Window>();
const loadingWindows = new Map<Window, Promise<void>>();
const windowControllers = new Map<Window, AbortController>();
let initializingViews: Promise<Views> | undefined;
let shuttingDown = false;
let activeViews: Views | undefined;
const graphs = new Map<Window, ConnectedPapers>();
let graphPaneID: string | undefined;

function registerGraphPane() {
  if (graphPaneID) return;
  const getGraph = (body: Element) => graphs.get(body.ownerDocument.defaultView as Window);
  graphPaneID = Zotero.ItemPaneManager.registerSection({
    paneID: `${config.addonRef}-graph`,
    pluginID: config.addonID,
    header: { l10nID: "refnexus-graph-pane-title", icon: `chrome://${config.addonRef}/content/icons/connectedpapers.png` },
    sidenav: { l10nID: "refnexus-graph-pane-sidenav", icon: `chrome://${config.addonRef}/content/icons/connectedpapers.png` },
    onInit: ({ body, tabType, setEnabled }) => {
      (body.ownerDocument as any).l10n?.addResourceIds([`${config.addonRef}-addon.ftl`]);
      setEnabled(tabType === "library" && Boolean(getGraph(body)?.graphVisible));
    },
    onItemChange: ({ body, item, tabType, setEnabled }) => {
      setEnabled(tabType === "library" && Boolean(item?.isRegularItem() && getGraph(body)?.graphVisible));
    },
    onRender: ({ body, tabType }) => {
      if (tabType === "library") getGraph(body)?.mountRelatedPane(body as HTMLElement);
    },
    onDestroy: ({ body }) => getGraph(body)?.unmountRelatedPane(body as HTMLElement),
  }) || undefined;
}

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);
  await Promise.all(Zotero.getMainWindows().map(win => onMainWindowLoad(win)));
}

function initializeViews(): Promise<Views> {
  return initializingViews ??= (async () => {
    await registerPrefs();
    if (shuttingDown) throw new Error("RefNexus stopped during startup");
    const views = new Views();
    activeViews = views;
    await views.onInit();
    if (shuttingDown) throw new Error("RefNexus stopped during startup");
    registry[config.addonInstance]!.views = views;
    registerGraphPane();
    return views;
  })().catch(async error => {
    if (!shuttingDown) {
      await activeViews?.shutdown().catch(cleanupError => Zotero.logError(cleanupError));
      activeViews = undefined;
      initializingViews = undefined;
    }
    throw error;
  });
}

function onMainWindowLoad(win: Window): Promise<void> {
  if (!win || win.closed || shuttingDown || initializedWindows.has(win)) return Promise.resolve();
  const pending = loadingWindows.get(win);
  if (pending) return pending;
  const controller = new (win as any).AbortController() as AbortController;
  windowControllers.set(win, controller);
  const current = () => !shuttingDown && !win.closed && !controller.signal.aborted;
  const task = (async () => {
    await Promise.all([Zotero.initializationPromise, Zotero.unlockPromise, Zotero.uiReadyPromise]);
    const deadline = Date.now() + 15000;
    const ready = () => Boolean((win as any).ZoteroPane?.itemsView && (win as any).ZoteroPane?.collectionsView?.itemTreeView);
    while (!ready() && current() && Date.now() < deadline) await Zotero.Promise.delay(50);
    if (!current()) return;
    if (!ready()) throw new Error("RefNexus: native Zotero item tree did not finish initialization");
    const views = await initializeViews();
    if (!current()) return;
    restoreLegacySidebarLayout(win.document);
    views.attachWindow(win);
    const graph = new ConnectedPapers(views, win);
    graphs.set(win, graph);
    try {
      await graph.init();
      if (!current()) { graph.shutdown(); graphs.delete(win); return; }
      initializedWindows.add(win);
    } catch (error) {
      graph.shutdown(); graphs.delete(win); views.detachWindow(win);
      throw error;
    }
  })().finally(() => {
    if (loadingWindows.get(win) === task) loadingWindows.delete(win);
    if (windowControllers.get(win) === controller) windowControllers.delete(win);
  });
  loadingWindows.set(win, task);
  return task;
}

async function onMainWindowUnload(win: Window): Promise<void> {
  if (win) {
    windowControllers.get(win)?.abort();
    initializedWindows.delete(win);
    activeViews?.detachWindow(win);
  }
  graphs.get(win)?.shutdown();
  graphs.delete(win);

}


async function onShutdown(): Promise<void> {
  shuttingDown = true;
  addon.data.alive = false;
  for (const controller of windowControllers.values()) controller.abort();
  for (const graph of graphs.values()) graph.shutdown();
  graphs.clear();
  await Promise.allSettled([...loadingWindows.values(), ...(initializingViews ? [initializingViews] : [])]);
  if (graphPaneID) Zotero.ItemPaneManager.unregisterSection(graphPaneID);
  graphPaneID = undefined;
  try { await activeViews?.shutdown(); }
  catch (error) { Zotero.logError(error instanceof Error ? error : new Error(String(error))); }
  activeViews=undefined;
  initializingViews=undefined;
  ztoolkit.unregisterAll();
  // Remove addon object
  addon.data.alive = false;
  addon.data.dialog?.window?.close();
  delete registry[config.addonInstance];
}

/**
 * This function is just an example of dispatcher for Preference UI events.
 * Any operations should be placed in a function to keep this funcion clear.
 * @param type event type
 * @param data event data
 */
async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  switch (type) {
    case "load":
      registerPrefsScripts(data.window);
      break;
    default:
      return;
  }
}

// Add your hooks here. For element click, etc.
// Keep in mind hooks only do dispatch. Don't add code that does real jobs in hooks.
// Otherwise the code would be hard to read and maintian.

export default {
  onStartup,
  onShutdown,
  onPrefsEvent,
  onMainWindowLoad,
  onMainWindowUnload
};
