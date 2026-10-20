import { config } from "../../package.json";


export async function registerPrefs() {
  const prefOptions = {
    pluginID: config.addonID,
    id: `${config.addonRef}-preferences`,
    src: rootURI + "chrome/content/preferences.xhtml",
    label: config.addonName || "RefFlow",
    image: `chrome://${config.addonRef}/content/icons/favicon.png`,
    scripts: [rootURI + "chrome/content/scripts/preferences.js"],
    stylesheets: [rootURI + "chrome/content/assets/preferences.css"],
    defaultXUL: true,
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
}

export function unregisterPrefs() {
  return (Zotero as any).PreferencePanes.unregister(`${config.addonRef}-preferences`);
}
