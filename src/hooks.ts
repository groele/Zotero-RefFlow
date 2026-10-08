import { config } from "../package.json";
import { registerPrefsScripts, registerPrefs } from "./modules/prefs";
import Views from "./modules/views";
import ConnectedPapers from "./modules/connectedpapers";
import { restoreLegacySidebarLayout } from "./modules/sidebarLayout";

const initializedWindows = new WeakSet<Window>();
let activeViews: Views | undefined;
const graphs = new Map<Window, ConnectedPapers>();
let ownerWindow: Window | undefined;
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
  restoreLegacySidebarLayout(win.document);
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
  registerGraphPane();
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
  if (graphPaneID) Zotero.ItemPaneManager.unregisterSection(graphPaneID);
  graphPaneID = undefined;
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
