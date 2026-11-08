import { config } from "../../package.json";
import {cacheSetting, cacheSettings} from "./cacheMaintenance";


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
  const capacityInputs = Array.from(root.querySelectorAll<HTMLInputElement>("[data-cache-capacity]")) as HTMLInputElement[];
  const usage = root.querySelector<HTMLElement>("#refflow-cache-usage");
  const clean = root.querySelector<HTMLButtonElement>("#refflow-cache-clean");
  const switches = ["save-pdf-references", "save-api-references"].map(id => win.document.getElementById(config.addonRef + "-" + id));
  const controller = new (win as Window & typeof globalThis).AbortController();
  const storage = addon.views?.storage;
  function updateUsage() {
    if(controller.signal.aborted || !storage || !usage)return;
    const value=storage.cacheUsage;
    usage.setAttribute("data-l10n-id",`${config.addonRef}-${!value.persistent?"cache-usage-memory":value.writeFailed?"cache-usage-failed":"cache-usage"}`);
    usage.setAttribute("data-l10n-args",JSON.stringify({items:value.items,maxItems:value.maxItems,
      used:(value.bytes/1048576).toFixed(2),limit:value.maxBytes/1048576,
      index:(value.indexBytes/1024).toFixed(1),
      evicted:storage.metrics.evictions,expired:storage.metrics.expired,skipped:storage.metrics.skipped}));
  }
  const unsubscribe = storage?.subscribe(updateUsage);
  clean?.addEventListener("click",async()=>{
    clean.disabled=true;
    try{await storage?.maintain();await storage?.flush();}
    catch(error){Zotero.logError(error as Error);}
    finally{if(!controller.signal.aborted){clean.disabled=false;updateUsage();}}
  },{signal:controller.signal});
  const location = root.querySelector<HTMLInputElement>("#refflow-cache-path");
  const openFolder = root.querySelector<HTMLButtonElement>("#refflow-cache-folder");
  function updateLocation() {
    const directory=storage?.directory;
    if(location){location.value=directory||"";location.title=directory||"";}
    if(openFolder)openFolder.disabled=!directory;
  }
  openFolder?.addEventListener("click", () => {
      try { if(storage?.directory)Zotero.launchFile(storage.directory); }
      catch (error) { Zotero.logError(error as Error); }
    }, {signal: controller.signal});
  function updateDependencies() {
    const enabled = Zotero.Prefs.get(key("cacheEnabled")) !== false;
    const pdf = enabled && Zotero.Prefs.get(key("savePDFReferences")) !== false;
    const online = enabled && Zotero.Prefs.get(key("saveAPIReferences")) !== false;
    for (const control of switches) control?.toggleAttribute("disabled", !enabled);
    for (const input of capacityInputs) {
      input.value=String(cacheSetting(input.dataset.cacheCapacity as keyof typeof cacheSettings));
      input.disabled=!enabled;
    }
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
  for(const input of capacityInputs)input.addEventListener("change",()=>{
    if(!input.disabled && input.validity.valid && Number.isInteger(input.valueAsNumber))Zotero.Prefs.set(key(input.dataset.cacheCapacity!),input.valueAsNumber);
    updateDependencies();
  },{signal:controller.signal});
  const observers = ["cacheEnabled","savePDFReferences","saveAPIReferences",...inputs.map(el=>el.dataset.cacheDuration!),...capacityInputs.map(el=>el.dataset.cacheCapacity!)].map(
    name => Zotero.Prefs.registerObserver(key(name), updateDependencies)
  );
  const dispose = () => {
    controller.abort();
    unsubscribe?.();
    for (const observer of observers) Zotero.Prefs.unregisterObserver(observer);
    activeCachePanes.delete(root);
    addon.data.preferenceCleanups.delete(dispose);
  };
  root.addEventListener("unload", dispose, {once:true,signal:controller.signal});
  win.addEventListener("unload", dispose, {once:true,signal:controller.signal});
  addon.data.preferenceCleanups.add(dispose);
  updateDependencies();
  updateUsage();
  updateLocation();
  void storage?.lock.promise.then(()=>{if(!controller.signal.aborted){updateUsage();updateLocation();}});
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
