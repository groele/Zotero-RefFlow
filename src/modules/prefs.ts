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

const activeCachePanes = new WeakSet<Element>();

function bindCachePreferences(win: Window) {
  const root = win.document.getElementById("zotero-prefpane-" + config.addonRef);
  if (!root || activeCachePanes.has(root)) return;
  activeCachePanes.add(root);
  const key = (name: string) => config.addonRef + "." + name;
  const inputs = Array.from(root.querySelectorAll<HTMLInputElement>("[data-cache-duration]")) as HTMLInputElement[];
  const switches = ["save-pdf-references", "save-api-references"].map(id => win.document.getElementById(config.addonRef + "-" + id));
  const controller = new (win as Window & typeof globalThis).AbortController();
  function updateDependencies() {
    const enabled = Zotero.Prefs.get(key("cacheEnabled")) !== false;
    const pdf = enabled && Zotero.Prefs.get(key("savePDFReferences")) !== false;
    const online = enabled && Zotero.Prefs.get(key("saveAPIReferences")) !== false;
    for (const control of switches) control?.toggleAttribute("disabled", !enabled);
    for (const input of inputs) {
      const name = input.dataset.cacheDuration!;
      input.value = String(Zotero.Prefs.get(key(name)));
      input.disabled = !(name === "partialMinutes" ? pdf || online : name === "pdfDays" ? pdf : online);
    }
  }
  for (const input of inputs) input.addEventListener("change", () => {
    if (!input.disabled && input.validity.valid && Number.isInteger(input.valueAsNumber)) {
      Zotero.Prefs.set(key(input.dataset.cacheDuration!), input.valueAsNumber);
    }
    updateDependencies();
  }, {signal: controller.signal});
  const observers = ["cacheEnabled","savePDFReferences","saveAPIReferences",...inputs.map(el=>el.dataset.cacheDuration!)].map(
    name => Zotero.Prefs.registerObserver(key(name), updateDependencies)
  );
  const dispose = () => {
    controller.abort();
    for (const observer of observers) Zotero.Prefs.unregisterObserver(observer);
    activeCachePanes.delete(root);
    addon.data.preferenceCleanups.delete(dispose);
  };
  root.addEventListener("unload", dispose, {once:true,signal:controller.signal});
  win.addEventListener("unload", dispose, {once:true,signal:controller.signal});
  addon.data.preferenceCleanups.add(dispose);
  updateDependencies();
}

export function registerPrefsScripts(_window: Window) {
  bindCachePreferences(_window);
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
