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

const RESETTABLE_PREFS: ReadonlyArray<readonly [string, boolean | number | string]> = [
  ["enable", true],
  ["prioritySource", "Auto"],
  ["autoRefresh", false],
  ["notAutoRefreshItemTypes", "book, letter, note"],
  ["isShowTip", true],
  ["ctrlClickTranslate", true],
  ["showTipAfterMillisecond", 233],
  ["shadeMillisecond", 233],
  ["removeTipAfterMillisecond", 500],
  ["tipBackgroundColor", "#ffffff"],
  ["tipTitleColor", "#2270d9"],
  ["cacheEnabled", true],
  ["referenceDays", 30],
  ["pdfDays", 30],
  ["neighborhoodDays", 30],
  ["partialMinutes", 15],
  ["cacheMaxMiB", 8],
  ["cacheMaxItems", 250],
  ["savePDFReferences", true],
  ["saveAPIReferences", true],
  ["notInLibarayOpacity", "1"],
  ["graphView.enable", false],
  ["graphView.height", "400px"],
  ["sortBy", "Original"],
  ["type", "References"],
  ["downloadOA", false],
  ["showSourceDetails", true],
  ["quickAction.copy-text", true],
  ["quickAction.copy-doi", true],
  ["quickAction.copy-url", true],
  ["quickAction.open", true],
  ["quickAction.import-selected", true],
  ["quickAction.import-all", true],
  ["quickAction.rollback", true],
];

function setControlDisabled(el: Element | null, disabled: boolean) {
  if (!el) return;
  el.toggleAttribute("disabled", disabled);
  if ("disabled" in el) {
    (el as HTMLInputElement).disabled = disabled;
  }
}

export function bindCachePreferences(win: Window) {
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
  const byId = <T extends Element = HTMLElement>(suffix: string) =>
    root?.querySelector<T>(`#${config.addonRef}-${suffix}`) ?? win.document.getElementById(`${config.addonRef}-${suffix}`) as T | null;
  const autoRefreshChild = byId<HTMLInputElement>("not-auto-refresh-item-types");
  const graphHeightInput = byId<HTMLInputElement>("graph-view-height");
  const tipChildIds = [
    "show-tip-after-millisecond",
    "ctrl-click-translate",
    "tip-background-color-picker",
    "tip-background-color",
    "tip-title-color-picker",
    "tip-title-color",
    "shade-millisecond",
    "remove-tip-after-millisecond",
  ];

  function updateDependencies() {
    const enabled = Zotero.Prefs.get(key("cacheEnabled")) !== false;
    const pdf = enabled && Zotero.Prefs.get(key("savePDFReferences")) !== false;
    const online = enabled && Zotero.Prefs.get(key("saveAPIReferences")) !== false;
    for (const control of switches) setControlDisabled(control, !enabled);
    for (const input of capacityInputs) {
      input.value = String(cacheSetting(input.dataset.cacheCapacity as keyof typeof cacheSettings));
      input.disabled = !enabled;
    }
    for (const input of inputs) {
      const name = input.dataset.cacheDuration!;
      input.value = String(Zotero.Prefs.get(key(name)));
      input.disabled = !(name === "partialMinutes" ? pdf || online : name === "pdfDays" ? pdf : online);
    }

    setControlDisabled(autoRefreshChild, Zotero.Prefs.get(key("autoRefresh")) !== true);
    const rawGraphHeight = String(Zotero.Prefs.get(key("graphView.height")) ?? "400px");
    const parsedGraphHeight = Number.parseInt(rawGraphHeight, 10);
    if (graphHeightInput && Number.isFinite(parsedGraphHeight)) {
      graphHeightInput.value = String(parsedGraphHeight);
    }
    setControlDisabled(graphHeightInput, Zotero.Prefs.get(key("graphView.enable")) !== true);

    const tipEnabled = Zotero.Prefs.get(key("isShowTip")) !== false;
    for (const id of tipChildIds) {
      setControlDisabled(byId(id), !tipEnabled);
    }
  }
  graphHeightInput?.addEventListener("change", () => {
    if (!graphHeightInput.disabled && graphHeightInput.validity.valid && Number.isInteger(graphHeightInput.valueAsNumber)) {
      const clamped = Math.min(1600, Math.max(200, graphHeightInput.valueAsNumber));
      graphHeightInput.value = String(clamped);
      Zotero.Prefs.set(key("graphView.height"), `${clamped}px`);
    }
  }, { signal: controller.signal });
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
  const parentCheckboxes: ReadonlyArray<readonly [string, string]> = [
    ["cacheEnabled", "cacheEnabled"],
    ["save-pdf-references", "savePDFReferences"],
    ["save-api-references", "saveAPIReferences"],
    ["auto-refresh", "autoRefresh"],
    ["graph-view-enable", "graphView.enable"],
    ["is-show-tip", "isShowTip"],
  ];
  for (const [elId, prefName] of parentCheckboxes) {
    const checkbox = byId<HTMLInputElement>(elId);
    const onToggle = () => {
      if (checkbox && typeof checkbox.checked === "boolean") {
        Zotero.Prefs.set(key(prefName), checkbox.checked);
      }
      updateDependencies();
    };
    checkbox?.addEventListener("command", onToggle, { signal: controller.signal });
    checkbox?.addEventListener("change", onToggle, { signal: controller.signal });
  }
  const observers = [
    "cacheEnabled",
    "savePDFReferences",
    "saveAPIReferences",
    "autoRefresh",
    "isShowTip",
    "graphView.enable",
    ...inputs.map(el => el.dataset.cacheDuration!),
    ...capacityInputs.map(el => el.dataset.cacheCapacity!),
  ].map(name => Zotero.Prefs.registerObserver(key(name), updateDependencies));
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

  // 实时回显未在文库条目的透明度滑块数值
  const opacityInput = byId<HTMLInputElement>("not-in-library-opacity");
  const opacityOutput = byId<HTMLOutputElement>("not-in-library-opacity-val");
  function updateOpacityDisplay() {
    if (opacityInput && opacityOutput) {
      const val = Number(opacityInput.value || 1);
      const percent = Math.round(val * 100);
      opacityOutput.setAttribute("data-l10n-id", `${config.addonRef}-range-percent`);
      opacityOutput.setAttribute("data-l10n-args", JSON.stringify({ percent }));
      if (!(win.document as any).l10n) {
        opacityOutput.textContent = `${percent}%`;
      }
    }
  }
  opacityInput?.addEventListener("input", updateOpacityDisplay, { signal: controller.signal });
  opacityInput?.addEventListener("change", updateOpacityDisplay, { signal: controller.signal });
  updateOpacityDisplay();

  // 颜色选择器与文本框双向同步
  const colorSyncCallbacks: Array<() => void> = [];
  function bindColorPair(textId: string, pickerId: string) {
    const textInput = root?.querySelector<HTMLInputElement>(textId);
    const pickerInput = root?.querySelector<HTMLInputElement>(pickerId);
    if (!textInput || !pickerInput) return;
    const syncToPicker = () => {
      const val = textInput.value.trim();
      if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(val)) {
        pickerInput.value = val.length === 4 ? `#${val[1]}${val[1]}${val[2]}${val[2]}${val[3]}${val[3]}` : val;
      }
    };
    const syncToText = () => {
      textInput.value = pickerInput.value;
      textInput.dispatchEvent(new Event("change", { bubbles: true }));
    };
    syncToPicker();
    colorSyncCallbacks.push(syncToPicker);
    textInput.addEventListener("input", syncToPicker, { signal: controller.signal });
    textInput.addEventListener("change", syncToPicker, { signal: controller.signal });
    pickerInput.addEventListener("input", syncToText, { signal: controller.signal });
    pickerInput.addEventListener("change", syncToText, { signal: controller.signal });
  }
  bindColorPair(`#${config.addonRef}-tip-background-color`, `#${config.addonRef}-tip-background-color-picker`);
  bindColorPair(`#${config.addonRef}-tip-title-color`, `#${config.addonRef}-tip-title-color-picker`);

  // API 密钥显示/隐藏切换
  const secretToggles = Array.from(root.querySelectorAll("[data-secret-toggle]")) as unknown as HTMLButtonElement[];
  for (const toggle of secretToggles) {
    toggle.addEventListener("click", () => {
      const targetId = toggle.getAttribute("data-secret-toggle");
      const target = targetId ? win.document.getElementById(targetId) as HTMLInputElement | null : null;
      if (!target) return;
      const show = target.type === "password";
      target.type = show ? "text" : "password";
      toggle.setAttribute("aria-pressed", String(show));
      toggle.setAttribute("data-l10n-id", `${config.addonRef}-key-toggle-${show ? "hide" : "show"}`);
    }, { signal: controller.signal });
  }

  const resetBtn = byId<HTMLButtonElement>("reset-defaults");
  const resetStatus = byId<HTMLElement>("reset-status");
  resetBtn?.addEventListener("click", () => {
    for (const [name, defaultValue] of RESETTABLE_PREFS) {
      Zotero.Prefs.set(key(name), defaultValue);
      const controls = Array.from(root.querySelectorAll(`[preference="extensions.zotero.${config.addonRef}.${name}"]`) as unknown as Iterable<HTMLElement>);
      for (const control of controls) {
        if (!control) continue;
        const tag = control.tagName?.toLowerCase();
        if (tag === "checkbox" || (control as HTMLInputElement).type === "checkbox") {
          (control as HTMLInputElement).checked = Boolean(defaultValue);
          control.toggleAttribute("checked", Boolean(defaultValue));
        } else if (tag === "input" && (control as HTMLInputElement).type === "number" && typeof defaultValue === "string") {
          const parsed = Number.parseInt(defaultValue, 10);
          (control as HTMLInputElement).value = Number.isFinite(parsed) ? String(parsed) : defaultValue;
        } else if ("value" in control) {
          (control as HTMLInputElement).value = String(defaultValue);
        }
      }
    }
    for (const syncColor of colorSyncCallbacks) syncColor();
    updateOpacityDisplay();
    updateDependencies();
    if (resetStatus) {
      resetStatus.setAttribute("data-l10n-id", `${config.addonRef}-reset-done`);
      if (!(win.document as any).l10n) {
        resetStatus.textContent = "reset-done";
      }
    }
  }, { signal: controller.signal });

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
