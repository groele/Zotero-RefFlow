import CitationVerifier, { CandidateWork } from "./verifier";

export interface TitleQuery { title: string; author?: string; year?: string; }
export interface TitleCandidate<T> { value: T; work: CandidateWork; id?: string; }

/** One identity must survive verification. Provider ordering is never evidence. */
export function selectUniqueTitle<T>(query: TitleQuery, candidates: TitleCandidate<T>[]): T | undefined {
  const title = CitationVerifier.cleanTitle(query.title);
  if (!title) return;
  const author = query.author?.trim();
  const year = query.year?.match(/\b(19\d\d|20\d\d)\b/)?.[0];
  const accepted = candidates.filter(({ work, id }) => {
    if (typeof work.title !== "string" || !work.title.trim()) return false;
    if (!CitationVerifier.normalizeDOI(work.doi) && !id) return false;
    // Supplied evidence must be corroborated, including when the title is exact.
    if (author && CitationVerifier.authorMatch(author, work.authors) < 0.85) return false;
    if (year && CitationVerifier.yearMatch(year, work.year) < 0.75) return false;
    const exact = title.length >= 20 && title === CitationVerifier.cleanTitle(work.title);
    return exact || CitationVerifier.evaluate({ title: query.title, author, year }, work).status === "ACCEPT";
  });
  if (!accepted.length) return;
  const dois = new Set(accepted.map(candidate => CitationVerifier.normalizeDOI(candidate.work.doi)).filter(Boolean));
  if (dois.size > 1) return;
  const identified = accepted.filter(candidate => CitationVerifier.normalizeDOI(candidate.work.doi));
  const ids = new Set((identified.length ? identified : accepted).map(candidate => candidate.id).filter(Boolean));
  if (!identified.length && ids.size !== 1) return;
  if (identified.length && accepted.some(candidate => !CitationVerifier.normalizeDOI(candidate.work.doi) && (!candidate.id || !ids.has(candidate.id)))) return;
  return (identified[0] || accepted[0]).value;
}
