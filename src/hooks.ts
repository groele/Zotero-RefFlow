import { config } from "../package.json";
import { registerPrefsScripts, registerPrefs } from "./modules/prefs";
import Views from "./modules/views";
import ConnectedPapers from "./modules/connectedpapers";

const initializedWindows = new WeakSet<Window>();

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
  registerPrefs();
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);
  if (!(ztoolkit.ProgressWindow.prototype as any)._showPatched) {
    const show = ztoolkit.ProgressWindow.prototype.show;
    ztoolkit.ProgressWindow.prototype.show = function () {
      Zotero.ProgressWindowSet.closeAll();
      return show.call(this, ...arguments);
    };
    (ztoolkit.ProgressWindow.prototype as any)._showPatched = true;
  }
  // 界面
  const views = new Views();
  await views.onInit();
  Zotero[config.addonInstance].views = views;
  await new ConnectedPapers(views).init();
}

async function onMainWindowUnload(win: Window): Promise<void> {
  if (win) {
    initializedWindows.delete(win);
  }
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
}


function onShutdown(): void {
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
