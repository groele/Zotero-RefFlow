import { tryReferenceData } from "./referenceData";

export interface ReferenceResult {
  references: ItemBaseInfo[];
  source: string;
  expected?: number;
  partial?: boolean;
  attempts?: string[];
  status?: "success" | "empty" | "partial" | "unavailable";
}
export interface ReferenceProvider { name: string; run: () => Promise<ReferenceResult | undefined>; }

export function referenceGaps(references: ItemBaseInfo[]): boolean {
  const numbers = references.map(ref => ref.number);
  if (numbers.every(number => number === undefined)) return false;
  return numbers.some((number, index) => !Number.isSafeInteger(number) || number !== index + 1);
}

/** This is the single completeness contract used before selection and caching. */
export function normalizeReferenceResult(value: ReferenceResult, fallbackSource = "Online"): ReferenceResult {
  const rows: unknown[] = Array.isArray(value.references) ? value.references : [];
  const references = rows.map(tryReferenceData).filter((row): row is ItemBaseInfo => Boolean(row));
  const expected = Number.isSafeInteger(value.expected) && value.expected! >= 0 ? value.expected : undefined;
  const invalidNumber = rows.some((row: any) => row?.number !== undefined && (!Number.isSafeInteger(row.number) || row.number < 1));
  const partial = Boolean(value.partial || value.status === "partial" || value.status === "unavailable" ||
    !Array.isArray(value.references) || references.length < rows.length || invalidNumber ||
    (expected !== undefined && references.length < expected) || referenceGaps(references));
  return { references, source: typeof value.source === "string" && value.source.trim() ? value.source : fallbackSource,
    expected, partial, attempts: Array.isArray(value.attempts) ? value.attempts.filter(attempt => typeof attempt === "string") : undefined,
    status: references.length ? (partial ? "partial" : "success") : partial ? "unavailable" : "empty" };
}

function checkCancelled(signal?: AbortSignal) {
  if (signal?.aborted) { const error = new Error("Reference retrieval cancelled"); error.name = "AbortError"; throw error; }
}

/** Select one whole list. A complete list wins; otherwise retain the largest usable partial list. */
export async function retrieveReferenceList(providers: ReferenceProvider[], signal?: AbortSignal,
  onProgress?: (source: string) => void): Promise<ReferenceResult> {
  let best: ReferenceResult | undefined;
  let unavailable = false;
  const attempts: string[] = [];
  for (const provider of providers) {
    checkCancelled(signal);
    onProgress?.(provider.name);
    try {
      const raw = await provider.run();
      checkCancelled(signal);
      const result = raw ? normalizeReferenceResult(raw, provider.name) : undefined;
      unavailable ||= !result || result.status === "unavailable";
      attempts.push(`${provider.name}: ${result?.references.length || 0}${result?.partial ? " (partial)" : ""}`);
      if (!result?.references.length) continue;
      if (!best || result.references.length > best.references.length) best = result;
      if (!result.partial) return { ...result, attempts };
    } catch (error: any) {
      if (error?.name === "AbortError" || signal?.aborted) throw error;
      attempts.push(`${provider.name}: ${String(error?.message || error).slice(0, 160)}`);
      unavailable = true;
    }
  }
  checkCancelled(signal);
  return best ? { ...best, attempts } : { references: [], source: "Auto", attempts,
    status: unavailable || !providers.length ? "unavailable" : "empty" };
}
