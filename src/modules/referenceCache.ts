const SCHEMA = 3;

/** Runtime Zotero item objects must never be serialized as reference metadata. */
export function cacheReferences(references: ItemBaseInfo[], signature: string, now = Date.now()) {
  const value = references.map(reference => {
    const { _item, ...metadata } = reference;
    return metadata;
  });
  return { schema: SCHEMA, signature, savedAt: now, references: value };
}

export function readCachedReferences(value: any, signature: string, maxAge: number, now = Date.now()): ItemBaseInfo[] | undefined {
  if (!value || value.schema !== SCHEMA || value.signature !== signature ||
    !Number.isFinite(value.savedAt) || value.savedAt > now || now - value.savedAt > maxAge || !Array.isArray(value.references)) return undefined;
  if (!value.references.every((ref: any) => ref && typeof ref === "object" &&
    (typeof ref.text === "string" || typeof ref.title === "string") &&
    (!ref.identifiers || typeof ref.identifiers === "object"))) return undefined;
  return value.references.map((reference: ItemBaseInfo) => ({ ...reference, identifiers: { ...reference.identifiers }, _item: undefined }));
}
