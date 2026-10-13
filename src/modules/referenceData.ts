import CitationVerifier from "./verifier";

/** Provider evidence is plain owned data; Zotero links stay runtime-only. */
export function referenceData(value: ItemBaseInfo): ItemBaseInfo {
  const { _item, _itemID, ...metadata } = value;
  const result = JSON.parse(JSON.stringify(metadata)) as ItemBaseInfo;
  result.title = typeof result.title === "string" ? result.title : "";
  result.text = typeof result.text === "string" ? result.text : result.title;
  result.authors = Array.isArray(result.authors) ? result.authors.filter(author => typeof author === "string") : [];
  result.identifiers = result.identifiers && typeof result.identifiers === "object" && !Array.isArray(result.identifiers) ? result.identifiers : {};
  for(const name of ["DOI","arXiv","CNKI","paperID"] as const)if(typeof result.identifiers[name]!=="string")delete result.identifiers[name];
  if (result.identifiers.DOI) result.identifiers.DOI = CitationVerifier.normalizeDOI(result.identifiers.DOI);
  if (typeof result.year === "string" || typeof result.year === "number") result.year = String(result.year);else delete result.year;
  if (!Number.isSafeInteger(result.number) || result.number! < 1) delete result.number;
  if (result.sources) result.sources = Array.isArray(result.sources) ? result.sources.filter(source => typeof source === "string") : [];
  return result;
}

/** Invalid provider rows cannot discard all the valid evidence in the response. */
export function tryReferenceData(value: unknown): ItemBaseInfo | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  try {
    const result = referenceData(value as ItemBaseInfo);
    if (!result.title.trim() && !result.text?.trim() && !result.identifiers.DOI) return;
    return result;
  } catch { return; }
}
