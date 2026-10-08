import { config } from "../package.json";
import { registerPrefsScripts, registerPrefs } from "./modules/prefs";
import Views from "./modules/views";
import ConnectedPapers from "./modules/connectedpapers";

const initializedWindows = new WeakSet<Window>();
let activeViews: Views | undefined;
const graphs = new Map<Window, ConnectedPapers>();
let ownerWindow: Window | undefined;

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);
  await onMainWindowLoad(window);
}

async function onMainWindowLoad(win: Window): Promise<void> {
  if (!win || initializedWindows.has(win)) {
    return;
  }
  initializedWindows.add(win);
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);
  const pane=(win as any).ZoteroPane;
  const deadline=Date.now()+15000;
  while((!pane?.itemsView || !pane?.collectionsView?.itemTreeView) && Date.now()<deadline && !win.closed)await Zotero.Promise.delay(50);
  if(win.closed)return;
  if(!pane?.itemsView || !pane?.collectionsView?.itemTreeView)throw new Error("RefNexus: native Zotero item tree did not finish initialization");
  if (activeViews) {
    const graph = new ConnectedPapers(activeViews, win);
    graphs.set(win, graph);
    await graph.init();
    return;
  }
  await registerPrefs();
  // 界面
  const views = new Views();
  activeViews=views;
  ownerWindow=win;
  await views.onInit();
  Zotero[config.addonInstance].views = views;
  const graph=new ConnectedPapers(views, win);
  graphs.set(win, graph);
  await graph.init();
}

async function onMainWindowUnload(win: Window): Promise<void> {
  if (win) {
    initializedWindows.delete(win);
  }
  graphs.get(win)?.shutdown();
  graphs.delete(win);
  if (win === ownerWindow) ownerWindow = graphs.keys().next().value;

}


async function onShutdown(): Promise<void> {
  await activeViews?.shutdown();
  for(const graph of graphs.values())graph.shutdown();
  graphs.clear();
  activeViews=undefined;
  ownerWindow=undefined;
  ztoolkit.unregisterAll();
  document
    .querySelectorAll(`#${config.addonRef}-show-hide-graph-view`)
    .forEach((e) => e.remove());
  // Remove addon object
  addon.data.alive = false;
  addon.data.dialog?.window?.close();
  delete Zotero[config.addonInstance];
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
