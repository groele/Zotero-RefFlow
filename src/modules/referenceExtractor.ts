export interface ReferenceTextLine {
  text: string;
  page: number;
  y: number;
}

export interface ExtractedReference {
  text: string;
  number?: number;
  page: number;
  y: number;
}

const BIBLIOGRAPHY_HEADING = /^(?:references?|bibliography|works\s+cited|literature\s+cited|参考文献|引用文献|文献)$/i;
const NUMBERED_START = /^\s*(?:\[(\d{1,4})\]|\((\d{1,4})\)|［(\d{1,4})］|(\d{1,4})\s*[.)、．]|(\d{1,4})\s+)/;
const AUTHOR_YEAR_START = /^\s*(?:[A-Z][A-Za-z'’.-]+(?:\s+(?:et\s+al\.?|and\s+[A-Z][A-Za-z'’.-]+|&\s*[A-Z][A-Za-z'’.-]+))?\s*[,.(]?\s*(?:18|19|20)\d{2}[a-z]?\b|[\u4e00-\u9fff]{2,8}(?:等|著)?[，,（( ]{0,3}(?:18|19|20)\d{2})/i;
const SECTION_HEADING = /^(?:(?:\d+(?:\.\d+)*\s+)?(?:appendix|acknowledg(?:e)?ments?|conclusion|discussion|supplementary)\b|附录|致谢|结论|讨论|补充材料)/i;

function normalizeText(text: string): string {
  return String(text || "")
    .replace(/[\u00ad\u200b\ufeff]/g, "")
    .replace(/[\t\u00a0]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getNumber(text: string): number | undefined {
  const match = text.match(NUMBERED_START);
  const value = match && match.slice(1).find(Boolean);
  return value ? Number(value) : undefined;
}

function stripNumber(text: string): string {
  return text.replace(NUMBERED_START, "").trim();
}

function isHeading(text: string): boolean {
  const clean = normalizeText(text).replace(/[.:：]$/, "");
  return clean.length < 50 && (BIBLIOGRAPHY_HEADING.test(clean) || SECTION_HEADING.test(clean));
}

/** Extract a bibliography section from page-ordered PDF text lines. */
export function extractReferencesFromLines(input: ReferenceTextLine[]): ExtractedReference[] {
  const lines = input
    .map(line => ({ ...line, text: normalizeText(line.text) }))
    .filter(line => line.text.length > 0)
    .sort((a, b) => a.page - b.page || b.y - a.y);
  if (!lines.length) return [];

  const headingIndex = lines.findIndex(line => BIBLIOGRAPHY_HEADING.test(line.text.replace(/[.:：]$/, "")));
  let start = headingIndex;
  if (start >= 0) start += 1;

  const collected: ExtractedReference[] = [];
  let current: ExtractedReference | undefined;
  let sawReference = false;
  for (let i = start >= 0 ? start : 0; i < lines.length; i++) {
    const line = lines[i];
    if (headingIndex >= 0 && sawReference && SECTION_HEADING.test(line.text) && !BIBLIOGRAPHY_HEADING.test(line.text)) break;
    if (BIBLIOGRAPHY_HEADING.test(line.text)) continue;

    const numbered = getNumber(line.text);
    const authorYear = AUTHOR_YEAR_START.test(line.text);
    const referenceStart = numbered !== undefined || (headingIndex >= 0 && authorYear);
    if (referenceStart) {
      if (current && current.text.length >= 12) collected.push(current);
      const text = numbered !== undefined ? stripNumber(line.text) : line.text;
      current = { text, number: numbered, page: line.page, y: line.y };
      sawReference = true;
      continue;
    }

    if (current) {
      // A new unnumbered author/year entry is a boundary even when its style is not numeric.
      if (authorYear && current.text.length > 30) {
        collected.push(current);
        current = { text: line.text, page: line.page, y: line.y };
      } else if (!isHeading(line.text) && line.text.length > 1) {
        current.text = `${current.text}${current.text.endsWith("-") ? "" : " "}${line.text}`;
      }
      continue;
    }

    // If no bibliography heading exists, don't treat arbitrary prose as a reference list.
    if (headingIndex < 0 && NUMBERED_START.test(line.text)) {
      current = { text: stripNumber(line.text), number: numbered, page: line.page, y: line.y };
      sawReference = true;
    }
  }
  if (current && current.text.length >= 12) collected.push(current);

  // Without a heading, require a coherent block of at least three entries. This avoids
  // returning numbered equations/steps from the article body as a bibliography.
  if (headingIndex < 0 && collected.length < 3) return [];
  return collected.filter(ref => ref.text.length >= 12);
}
