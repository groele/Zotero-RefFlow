import CitationVerifier from "./verifier";

/** Stable identity for UI state only; never a substitute for Zotero library identity. */
export function referenceIdentity(ref:ItemBaseInfo):string {
  const doi=CitationVerifier.normalizeDOI(ref.identifiers?.DOI);
  if(doi)return `doi:${doi}`;
  if(ref.identifiers?.arXiv)return `arxiv:${ref.identifiers.arXiv.toLowerCase().replace(/v\d+$/i,"")}`;
  return JSON.stringify([CitationVerifier.cleanTitle(ref.title||ref.text||""),String(ref.year||""),(ref.authors||[]).map(author=>author.toLowerCase())]);
}
