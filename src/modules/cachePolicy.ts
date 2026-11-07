import { config } from "../../package.json";

const read = (key: string) => Zotero.Prefs.get(config.addonRef + "." + key);
export function cacheEnabled(source?: string): boolean {
  return read("cacheEnabled") !== false && (!source || read(/^PDF\b/.test(source) ? "savePDFReferences" : "saveAPIReferences") !== false);
}

export function retentionMs(kind: "reference" | "neighborhood" | "pdf", partial: boolean): number {
  const [key, fallback, unit, max] = partial ? ["partialMinutes", 15, 60000, 10080] as const
    : kind === "pdf" ? ["pdfDays", 0, 86400000, 3650] as const
    : kind === "neighborhood" ? ["neighborhoodDays", 1, 86400000, 3650] as const
    : ["referenceDays", 1, 86400000, 3650] as const;
  const value = read(key);
  const n = typeof value === "number" && Number.isInteger(value) && value >= (partial ? 1 : 0) && value <= max ? value : fallback;
  return n ? n * unit : Number.MAX_SAFE_INTEGER;
}

// Child provider deadlines inherit the pane's cache bypass without affecting other panes.
const refreshSignals = new WeakSet<AbortSignal>();
export function markFresh(signal: AbortSignal) { refreshSignals.add(signal); }
export function isFresh(signal?: AbortSignal) { return !!signal && refreshSignals.has(signal); }
