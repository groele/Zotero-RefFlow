import {config} from "../../package.json";
import LocalStorage from "./localStorage";
import {retentionMs} from "./cachePolicy";

export const cacheSettings = {
  cacheMaxMiB: {fallback:8,min:1,max:64},
  cacheMaxItems: {fallback:250,min:10,max:10000}
};

export function cacheSetting(name:keyof typeof cacheSettings){
  const rule=cacheSettings[name];
  const value=Zotero.Prefs.get(`${config.addonRef}.${name}`);
  return typeof value==="number"&&Number.isInteger(value)&&value>=rule.min&&value<=rule.max?value:rule.fallback;
}

export function cacheLimits(){return {maxBytes:cacheSetting("cacheMaxMiB")*1024*1024,maxItems:cacheSetting("cacheMaxItems")};}

/** Only owned reference snapshots expire. Other per-item settings are preserved. */
export function referenceSnapshotExpired(key: string, value: any, now = Date.now()): boolean {
  if (!key.startsWith("References-")) return false;
  if (value?.schema !== 4 || !Number.isFinite(value.savedAt) || value.savedAt > now) return true;
  const snapshot = value.snapshot;
  const partial = Boolean(snapshot?.partial || snapshot?.truncated ||
    ["partial", "unavailable", "empty"].includes(snapshot?.status));
  let kind: "reference" | "neighborhood" | "pdf" = "reference";
  if (key.startsWith("References-API-")) kind = "neighborhood";
  else if (key === "References-PDF" || /^PDF\b/.test(snapshot?.source)) kind = "pdf";
  return now - value.savedAt > retentionMs(kind, partial);
}

/** One maintenance owner per plugin, independent of settings windows. */
export default class CacheMaintenance {
  private timer: ReturnType<typeof globalThis.setInterval>;
  private observers: symbol[] = [];
  private disposed = false;

  constructor(private storage: LocalStorage) {
    const settings = ["cacheMaxMiB", "cacheMaxItems", "referenceDays", "pdfDays", "neighborhoodDays", "partialMinutes"];
    for (const name of settings) {
      this.observers.push(Zotero.Prefs.registerObserver(`${config.addonRef}.${name}`, () => this.run()));
    }
    this.timer = globalThis.setInterval(() => this.run(), 10 * 60 * 1000);
    this.run();
  }

  private run() {
    if (this.disposed) return;
    void this.storage.maintain(cacheLimits()).catch(error =>
      ztoolkit.log("Cache maintenance failed", String(error)));
  }

  dispose() {
    this.disposed = true;
    globalThis.clearInterval(this.timer);
    for (const observer of this.observers) Zotero.Prefs.unregisterObserver(observer);
    this.observers = [];
  }
}
