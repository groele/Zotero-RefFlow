export interface ReferenceTextLine {
  text: string;
  page: number;
  y: number;
  x?: number;
  /** Reading order reconstructed by the PDF layout pass (including columns). */
  order?: number;
  margin?: boolean;
}

export interface ExtractedReference {
  text: string;
  number?: number;
  page: number;
  y: number;
  x?: number;
}

const BIBLIOGRAPHY_HEADING = /^(?:(?:\d+(?:\.\d+)*\.?|[IVX]+\.)\s+)?(?:references?(?:\s+(?:and|&)\s+notes)?|bibliography|works\s+cited|literature\s+cited|références|referencias|literatur|参考文献|引用文献|文献)(?:\s*\(?continued\)?|\s*\(续\))?$/i;
const NUMBERED_START = /^\s*(?:\[(\d{1,4})\]|\((\d{1,4})\)|［(\d{1,4})］|(\d{1,4})\s*[.)、．]|(\d{1,4})\s+)/;
const AUTHOR_YEAR_START = /^\s*(?:[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'’.-]+(?:\s+(?:et\s+al\.?|and\s+[A-Z][A-Za-z'’.-]+|&\s*[A-Z][A-Za-z'’.-]+))?\s*[,.(]?\s*(?:18|19|20)\d{2}[a-z]?\b|[\u4e00-\u9fff]{2,8}(?:等|著)?[，,（( ]{0,3}(?:18|19|20)\d{2})/i;
const AUTHOR_INITIALS_START = /^(?:(?:(?:van|von|de|del|der|da|di|du|la|le)\s+){0,3}\p{Lu}[\p{L}'’.-]{1,40},?\s+\p{Lu}\.(?:\s*\p{Lu}\.)?|[\u4e00-\u9fff]{2,8}[，,]\s*[\u4e00-\u9fff]{2,8})/u;
const SECTION_HEADING = /^(?:(?:\d+(?:\.\d+)*\s+)?(?:appendix|acknowledg(?:e)?ments?|conclusion|discussion|supplementary|supporting\s+information|methods|author\s+contributions?|competing\s+interests?|conflicts?\s+of\s+interest|data\s+availability|funding|publisher[’']?s\s+note)\b|附录|致谢|结论|讨论|补充材料)/i;

function normalizeText(text: string): string {
  return String(text || "")
    .replace(/[\u00ad\u200b\ufeff]/g, "")
    .replace(/[ﬀﬁﬂﬃﬄ]/g, value=>({"ﬀ":"ff","ﬁ":"fi","ﬂ":"fl","ﬃ":"ffi","ﬄ":"ffl"}[value]!))
    .replace(/[\t\u00a0]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getNumber(text: string): number | undefined {
  const match = text.match(NUMBERED_START);
  const value = match && match.slice(1).find(Boolean);
  // A continuation line beginning with a year is not a reference-number boundary.
  return value && (!match?.[4] && !match?.[5] || Number(value) < 1800 || Number(value) > 2100) ? Number(value) : undefined;
}

function stripNumber(text: string): string {
  return text.replace(NUMBERED_START, "").trim();
}

function isHeading(text: string): boolean {
  const clean = normalizeText(text).replace(/[.:：]$/, "");
  return clean.length < 50 && (BIBLIOGRAPHY_HEADING.test(clean) || SECTION_HEADING.test(clean));
}

export function isBibliographyHeading(text: string): boolean {
  return BIBLIOGRAPHY_HEADING.test(normalizeText(text).replace(/[.:：]$/, ""));
}

export function isReferenceStart(text: string): boolean {
  return getNumber(text) !== undefined || AUTHOR_YEAR_START.test(text) || AUTHOR_INITIALS_START.test(text);
}

/** Extract a bibliography section from page-ordered PDF text lines. */
export function extractReferencesFromLines(input: ReferenceTextLine[]): ExtractedReference[] {
  // Repeated margin text is a running header/footer, not part of a wrapped citation.
  const repeated=new Map<string,Set<number>>();
  for(const line of input)if(line.margin&&!isBibliographyHeading(line.text)&&getNumber(line.text)===undefined){const key=normalizeText(line.text);const pages=repeated.get(key)||new Set<number>();pages.add(line.page);repeated.set(key,pages);}
  const lines = input
    .map(line => ({ ...line, text: normalizeText(line.text) }))
    .filter(line => line.text.length > 0 && !/^\d{1,4}$/.test(line.text) && !(line.margin&&(repeated.get(line.text)?.size||0)>=2))
    .sort((a, b) => a.page - b.page || (a.order !== undefined && b.order !== undefined ? a.order - b.order : b.y - a.y));
  if (!lines.length) return [];

  const headingIndex = lines.findIndex(line => isBibliographyHeading(line.text));
  let start = headingIndex;
  if (start >= 0) start += 1;

  const collected: ExtractedReference[] = [];
  let current: ExtractedReference | undefined;
  let sawReference = false;
  let numberedStyle = false;
  let inBibliography=headingIndex<0;
  const finish=()=>{if(current&&current.text.length>=12)collected.push(current);current=undefined;};
  for (let i = start >= 0 ? start : 0; i < lines.length; i++) {
    const line = lines[i];
    if(i===(start>=0?start:0))inBibliography=true;
    if (isBibliographyHeading(line.text)) {inBibliography=true;continue;}
    if (sawReference && SECTION_HEADING.test(line.text)) {finish();inBibliography=false;continue;}
    if(!inBibliography)continue;

    const numbered = getNumber(line.text);
    const authorYear = (AUTHOR_YEAR_START.test(line.text) || AUTHOR_INITIALS_START.test(line.text)) &&
      (!current || current.x===undefined || line.x===undefined || line.x<=current.x+4);
    const referenceStart = numbered !== undefined || (headingIndex >= 0 && authorYear && !numberedStyle);
    if (referenceStart) {
      if (current && current.text.length >= 12) collected.push(current);
      const text = numbered !== undefined ? stripNumber(line.text) : line.text;
      current = { text, number: numbered, page: line.page, y: line.y, x: line.x };
      sawReference = true;
      if(numbered!==undefined) numberedStyle=true;
      continue;
    }

    if (current) {
      // A new unnumbered author/year entry is a boundary even when its style is not numeric.
      if (authorYear && !numberedStyle && current.text.length > 30) {
        collected.push(current);
        current = { text: line.text, page: line.page, y: line.y };
      } else if (!isHeading(line.text) && line.text.length > 1) {
        // Preserve meaningful hyphens (spin-orbit); only join soft-hyphen runs in layout.
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
  finish();

  // Without a heading, require a coherent block of at least three entries. This avoids
  // returning numbered equations/steps from the article body as a bibliography.
  if (headingIndex < 0) {
    if (collected.length < 3) return [];
    const evidence = collected.filter(ref => /\b(?:18|19|20)\d{2}\b|10\.\d{4,9}\//.test(ref.text));
    const orderedNumbers = collected.every((ref, i) => i === 0 || ref.number === (collected[i - 1].number || 0) + 1);
    if (evidence.length < Math.ceil(collected.length * 0.6) || !orderedNumbers) return [];
  }
  return collected.filter(ref => ref.text.length >= 12);
}
