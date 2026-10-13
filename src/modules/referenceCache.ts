const SCHEMA = 3;
import { referenceData, tryReferenceData } from "./referenceData";
import { normalizeReferenceResult, ReferenceResult } from "./referenceRetrieval";

/** Runtime Zotero item objects must never be serialized as reference metadata. */
export function cacheReferences(references: ItemBaseInfo[], signature: string, now = Date.now()) {
  const value = references.map(referenceData);
  return { schema: SCHEMA, signature, savedAt: now, references: value };
}

export function readCachedReferences(value: any, signature: string, maxAge: number, now = Date.now()): ItemBaseInfo[] | undefined {
  if (!value || value.schema !== SCHEMA || value.signature !== signature ||
    !Number.isFinite(value.savedAt) || value.savedAt > now || now - value.savedAt > maxAge || !Array.isArray(value.references)) return undefined;
  const references = value.references.map(tryReferenceData);
  if (references.some((reference: ItemBaseInfo | undefined) => !reference)) return undefined;
  return references as ItemBaseInfo[];
}

/** Persist and restore the same result contract; presentation text never enters the snapshot. */
export function cacheReferenceResult(value: ReferenceResult, signature: string, now = Date.now()) {
  const result = normalizeReferenceResult(value);
  return { ...cacheReferences(result.references, signature, now),
    snapshot: { source: result.source, expected: result.expected, partial: result.partial, status: result.status } };
}

export function readCachedReferenceResult(value: any, signature: string, now = Date.now()): ReferenceResult | undefined {
  const partial = value?.snapshot?.partial || ["partial", "unavailable"].includes(value?.snapshot?.status);
  const references = readCachedReferences(value, signature, partial ? 15 * 60 * 1000 : 24 * 60 * 60 * 1000, now);
  if (!references || !value.snapshot || typeof value.snapshot !== "object") return;
  return normalizeReferenceResult({ ...value.snapshot, references });
}

export function preferCachedReferences(result: ReferenceResult, previous: ReferenceResult | undefined, offlineLabel: string): ReferenceResult {
  if (result.references.length || !previous?.references.length) return result;
  return { ...previous, source: `${previous.source} · ${offlineLabel}`, attempts: result.attempts };
}
