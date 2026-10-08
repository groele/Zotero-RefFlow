import { config } from "../../package.json";


export async function registerPrefs() {
  const prefOptions = {
    pluginID: config.addonID,
    id: `${config.addonRef}-preferences`,
    src: rootURI + "chrome/content/preferences.xhtml",
    label: config.addonName || "RefNexus",
    image: `chrome://${config.addonRef}/content/icons/favicon.png`,
    // extraDTD: [`chrome://${config.addonRef}/locale/overlay.dtd`],
    // defaultXUL: true,
  };
  await (Zotero as any).PreferencePanes.register(prefOptions);
}

export function registerPrefsScripts(_window: Window) {
  if (!addon.data.prefs) {
    addon.data.prefs = {
      window: _window,
    };
  } else {
    addon.data.prefs.window = _window;
  }
  const doc = addon.data.prefs!.window.document
}
