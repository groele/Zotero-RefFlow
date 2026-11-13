import CitationVerifier from "../verifier";

export interface WesternCitationResult {
  authors: string[];
  title: string;
  year?: string;
  publicationVenue?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
  style: "IEEE" | "APA" | "Vancouver" | "MLA";
}

/**
 * Deterministic parser for mainstream Western citation styles:
 * IEEE, APA (Harvard-derivative), Vancouver (NLM/AMA), and MLA.
 */
export class WesternCitationParser {
  private static cleanText(raw: string): { text: string; doi?: string } {
    let text = raw.trim().replace(/^(\[\d{1,4}\]|\(\d{1,4}\)|\d{1,4}\s*[.)、．])\s*/, "").trim();
    let doi: string | undefined;
    const doiMatch = text.match(/10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/);
    if (doiMatch) {
      doi = CitationVerifier.normalizeDOI(doiMatch[0]);
    }
    return { text, doi };
  }

  /**
   * Attempt parsing against all supported Western citation grammars.
   */
  public static parse(raw: string): WesternCitationResult | null {
    if (!raw || raw.length < 15) return null;
    return (
      this.parseIEEE(raw) ||
      this.parseAPA(raw) ||
      this.parseVancouver(raw) ||
      this.parseMLA(raw)
    );
  }

  /**
   * IEEE Style:
   * J. K. Author and A. B. Researcher, "Title of paper," Abbrev. Title of Periodical, vol. x, no. x, pp. xxx-xxx, 2021.
   */
  public static parseIEEE(raw: string): WesternCitationResult | null {
    const { text, doi } = this.cleanText(raw);
    const quoteMatch = text.match(/^(.*?)[,\s]*["“‘]([^"”’]+)["”’][,\s]*(.*)$/);
    if (!quoteMatch) return null;

    const authorStr = quoteMatch[1].trim();
    const title = quoteMatch[2].trim().replace(/[,.]$/, "");
    const rest = quoteMatch[3].trim();

    if (!authorStr || !title || title.length < 3) return null;

    // Check if author part contains IEEE style initials like "A. B. Last"
    const authors = authorStr
      .split(/(?:,\s*(?:and\s+)?|\s+and\s+)/i)
      .map((a) => a.trim().replace(/^and\s+/i, ""))
      .filter((a) => a.length > 0 && !/et\s*al/i.test(a));

    if (!authors.length && authorStr) authors.push(authorStr);

    const yearMatch = rest.match(/\b(19\d\d|20\d\d)\b/);
    const year = yearMatch ? yearMatch[1] : undefined;

    const volMatch = rest.match(/\bvol\.\s*(\d+)/i);
    const volume = volMatch ? volMatch[1] : undefined;

    const noMatch = rest.match(/\bno\.\s*([A-Za-z0-9\-]+)/i);
    const issue = noMatch ? noMatch[1] : undefined;

    const ppMatch = rest.match(/\bpp?\.\s*([\d\-–—]+)/i);
    const pages = ppMatch ? ppMatch[1] : undefined;

    const venueMatch = rest.match(/^([^,.]+)/);
    const publicationVenue = venueMatch ? venueMatch[1].replace(/^(?:in\s+|proceedings\s+of\s+)/i, "").trim() : undefined;

    return {
      authors,
      title,
      year,
      publicationVenue,
      volume,
      issue,
      pages,
      doi,
      style: "IEEE"
    };
  }

  /**
   * APA / Harvard Style:
   * Author, A. A., & Author, B. B. (2020). Title of the article. Journal Name, 15(2), 100-115.
   */
  public static parseAPA(raw: string): WesternCitationResult | null {
    const { text, doi } = this.cleanText(raw);
    const dateMatch = text.match(/^(.*?)\s*[(（]((?:18|19|20)\d{2}[a-z]?)[)）]\s*[.:]\s*(.+)$/);
    if (!dateMatch) return null;

    const authorPart = dateMatch[1].trim();
    const year = dateMatch[2].trim();
    const afterDate = dateMatch[3].trim();

    if (!authorPart || !afterDate) return null;

    // Title is typically from afterDate up to the first dot followed by space or capital letter
    const titleDot = afterDate.match(/^(.*?)\.\s+(.*)$/);
    let title = "";
    let rest = "";
    if (titleDot) {
      title = titleDot[1].trim();
      rest = titleDot[2].trim();
    } else {
      title = afterDate.replace(/[.]$/, "").trim();
    }

    if (title.length < 3) return null;

    const authors = authorPart
      .split(/(?:,\s*&|\s+&\s+|,|\s+and\s+)/i)
      .map((a) => a.trim().replace(/^&\s*/, ""))
      .filter((a) => a.length > 0 && !/et\s*al/i.test(a));

    const volIssue = rest.match(/(\d+)\s*\(([^)]+)\)[,\s:]*([\d\-–—]+)?/);
    let volume: string | undefined;
    let issue: string | undefined;
    let pages: string | undefined;
    if (volIssue) {
      volume = volIssue[1];
      issue = volIssue[2];
      pages = volIssue[3];
    } else {
      const pageOnly = rest.match(/:\s*([\d\-–—]+)/);
      if (pageOnly) pages = pageOnly[1];
    }

    const venue = rest.split(/[,.]/)[0]?.trim();

    return {
      authors: authors.length ? authors : [authorPart],
      title,
      year,
      publicationVenue: venue || undefined,
      volume,
      issue,
      pages,
      doi,
      style: "APA"
    };
  }

  /**
   * Vancouver / NLM / AMA Style:
   * Author AA, Author BB. Title of article. Abbrev J Title. 2020;12(3):45-50.
   */
  public static parseVancouver(raw: string): WesternCitationResult | null {
    const { text, doi } = this.cleanText(raw);
    const datePattern = /(?:[.;]\s*|\s+)((?:18|19|20)\d{2})\s*;\s*(?:(\d+)(?:\(([^)]+)\))?\s*:\s*)?([\d\-–—]+)?/;
    const dateMatch = text.match(datePattern);
    if (!dateMatch || dateMatch.index === undefined) return null;

    const year = dateMatch[1];
    const volume = dateMatch[2];
    const issue = dateMatch[3];
    const pages = dateMatch[4];

    const beforeDate = text.substring(0, dateMatch.index).trim();
    const segments = beforeDate.split(/\.\s+/).map((s) => s.trim()).filter(Boolean);
    if (segments.length < 2) return null;

    const authorPart = segments[0];
    const title = segments[1];
    const venue = segments.slice(2).join(". ");

    const authors = authorPart
      .split(/[,;]/)
      .map((a) => a.trim())
      .filter((a) => a.length > 0 && !/et\s*al/i.test(a));

    return {
      authors: authors.length ? authors : [authorPart],
      title,
      year,
      publicationVenue: venue || undefined,
      volume,
      issue,
      pages,
      doi,
      style: "Vancouver"
    };
  }

  /**
   * MLA Style:
   * Author, First. "Title of Article." Title of Journal, vol. 12, no. 3, 2020, pp. 45-50.
   */
  public static parseMLA(raw: string): WesternCitationResult | null {
    const { text, doi } = this.cleanText(raw);
    const mlaMatch = text.match(/^(.*?)\.\s*["“‘]([^"”’]+)["”’]\.?\s*(.*)$/);
    if (!mlaMatch) return null;

    const authorPart = mlaMatch[1].trim();
    const title = mlaMatch[2].trim().replace(/[.,]$/, "");
    const rest = mlaMatch[3].trim();

    const yearMatch = rest.match(/\b(19\d\d|20\d\d)\b/);
    const year = yearMatch ? yearMatch[1] : undefined;

    const volMatch = rest.match(/\bvol\.\s*(\d+)/i);
    const volume = volMatch ? volMatch[1] : undefined;

    const noMatch = rest.match(/\bno\.\s*([A-Za-z0-9\-]+)/i);
    const issue = noMatch ? noMatch[1] : undefined;

    const ppMatch = rest.match(/\bpp?\.\s*([\d\-–—]+)/i);
    const pages = ppMatch ? ppMatch[1] : undefined;

    const venue = rest.split(/[,.]/)[0]?.trim();

    return {
      authors: [authorPart],
      title,
      year,
      publicationVenue: venue || undefined,
      volume,
      issue,
      pages,
      doi,
      style: "MLA"
    };
  }
}

export default WesternCitationParser;
