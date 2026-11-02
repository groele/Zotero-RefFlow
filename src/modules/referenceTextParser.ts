import GBT7714Parser from "./parsers/gbt7714";
import CitationVerifier from "./verifier";

export const REF_REGEX = {
  DOI: /10\.\d{4,9}\/[-._;()/:A-Za-z0-9><]+[^\.\]]/,
  arXiv: /(?:arXiv[\.:\s]|arxiv\.org\/abs\/)(\d{4}\.\d{4,5}(?:v\d+)?|[a-z\-]+(?:\.[A-Z]{2})?\/\d{7})/i,
  URL: /https?:\/\/[^\s<>"'{}|\\^`]+/i
};

export class ReferenceTextParser {
  public static regex = REF_REGEX;

  public static getIdentifiers(text: string): ItemBaseInfo["identifiers"] {
    const identifiers: ItemBaseInfo["identifiers"] = {};
    if (!text) return identifiers;

    // 1. DOI 探测与归一化
    const doiMatch = text.match(/10\.\d{4,9}\/[^\s"'`\\]+/);
    if (doiMatch) {
      const clean = CitationVerifier.normalizeDOI(doiMatch[0]);
      if (clean && !/(cnki|issn)/i.test(clean)) {
        identifiers.DOI = clean;
      }
    }

    // 2. arXiv 探测 (支持新版、5位号、版本号以及旧版编号)
    const arxivMatch = text.match(/(?:arXiv[\.:\s]|arxiv\.org\/abs\/)(\d{4}\.\d{4,5}(?:v\d+)?|[a-z\-]+(?:\.[A-Z]{2})?\/\d{7})/i);
    if (arxivMatch) {
      identifiers.arXiv = arxivMatch[1];
    }

    return identifiers;
  }

  public static extractURL(text: string): string | undefined {
    const res = text.match(REF_REGEX.URL);
    if (res) {
      return res[0].replace(/[.,;:()\[\]]+$/, "");
    }
  }

  public static parseRefText(text: string): { year?: string, authors?: string[], title: string, publicationVenue?: string } {
    try {
      text = text.replace(/^\[\d+?\]/, "");
      text = text.replace(/\s+/g, " ");
      // 匹配标题 (支持中文双引号 “”、书名号 《》、以及英文直引号 "")
      let title: string = "";
      let titleMatch: string = "";
      const quoteMatch = text.match(/[\u201c"《]([^\u201d"》]+)[\u201d"》]/);
      if (quoteMatch) {
        titleMatch = quoteMatch[0];
        title = quoteMatch[1].trim();
        if (title.endsWith(",")) {
          title = title.slice(0, -1);
        }
      } else {
        const segments = ((text.indexOf(". ") != -1 && text.match(/\.\s/g)!.length >= 2) && text.split(". ") || text.split("."))
          .map(s => s.trim())
          .filter(s => s.length > 0);

        if (segments.length >= 2) {
          title = titleMatch = segments
            .sort((a, b) => b.length - a.length)
            .map((s: string) => {
              let count = 0;
              [/[A-Z]\./g, /[,\.\-\(\)\:]/g, /\d/g].forEach(regex => {
                const res = s.match(regex);
                count += (res ? res.length : 0);
              });
              return [count / s.length, s] as [number, string];
            })
            .filter((s: [number, string]) => ((s[1].match(/\s+/g)?.length ?? 0) >= 2))
            .sort((a: [number, string], b: [number, string]) => a[0] - b[0])?.[0]?.[1] || segments[0];
        } else {
          title = titleMatch = segments[0] || text;
        }

        if (/\[[A-Z]\]$/.test(title)) {
          title = title.replace(/\[[A-Z]\]$/, "");
        }
      }
      title = title.trim();

      const splitByTitle = text.split(titleMatch);
      let authorInfo = splitByTitle[0]?.trim() || "";

      let publicationVenue: string | undefined = undefined;
      if (splitByTitle[1]) {
        const venueMatch = splitByTitle[1].match(/[^.\s].+[^\.]/);
        if (venueMatch) {
          publicationVenue = venueMatch[0].split(/[,\d]/)[0].trim();
        }
      }

      if (authorInfo.indexOf("et al.") != -1) {
        authorInfo = authorInfo.split("et al.")[0] + "et al.";
      }
      const currentYear = new Date().getFullYear();
      const res = text.match(/[^\d]\d{4}[^\d-]/g)?.map(s => s.match(/\d+/)![0]);
      const year = res?.find(s => {
        return Number(s) <= Number(currentYear) + 1;
      });

      if (year) {
        authorInfo = authorInfo.replace(`${year}.`, "").replace(year, "").trim();
      }

      return {
        year,
        title: title || text,
        authors: authorInfo ? [authorInfo] : [],
        publicationVenue
      };
    } catch {
      return {
        title: text
      };
    }
  }

  public static _parseRefText(text: string): { year: string, authors: string[], title: string } {
    let year: string | undefined;
    const _years = text.match(/[^\d]?(\d{4})[^\d]?/g) as string[];
    if (_years) {
      const years = _years
        .map(y => Number(y.match(/\d{4}/)![0]))
        .filter(y => y > 1900 && y < (new Date()).getFullYear());
      if (years.length > 0) { year = String(years[0]); }
    }
    year = year as string;
    if (ReferenceTextParser.isChinese(text)) {
      const parts = text
        .replace(/\[.+?\]/g, "")
        .replace(/\s+/g, " ")
        .split(/[\.,\uff0c\uff0e\uff3b\[\]]/)
        .map(e => e.trim())
        .filter(e => e);
      const authors: string[] = [];
      const titles: string[] = [];
      for (const part of parts) {
        if (part.length <= 3 && part.length >= 2) {
          authors.push(part);
        } else {
          titles.push(part);
        }
      }
      const title = titles.sort((a, b) => b.length - a.length)[0];
      return { title, authors, year };
    } else {
      const authors: string[] = [];
      text = text.replace(/[\u4e00-\u9fa5]/g, "");
      const authorRegexs = [/[A-Za-z,\.\s]+?\.?[\.,;]/g, /[A-Z][a-z]+ et al.,/];
      authorRegexs.forEach(regex => {
        text.match(regex)?.forEach(author => {
          authors.push(author.slice(0, -1));
        });
      });
      const title = text
        .split(/[,\.]\s/g)
        .filter((e: string) => !e.includes("http"))
        .sort((a, b) => b.length - a.length)[0];
      return { title, authors, year };
    }
  }

  public static identifiers2URL(identifiers: ItemBaseInfo["identifiers"]) {
    let url: string | undefined;
    if (identifiers.DOI) {
      url = `https://doi.org/${identifiers.DOI}`;
    }
    if (identifiers.arXiv) {
      url = `https://arxiv.org/abs/${identifiers.arXiv}`;
    }
    return url;
  }

  public static refText2Info(text: string): ItemBaseInfo {
    const identifiers = ReferenceTextParser.getIdentifiers(text);

    // 优先采用国标 GB/T 7714 确定性解析
    if (GBT7714Parser.isGBT7714(text)) {
      const gbt = GBT7714Parser.parse(text);
      if (gbt) {
        if (gbt.doi) identifiers.DOI = CitationVerifier.normalizeDOI(gbt.doi);
        return {
          identifiers: identifiers,
          url: ReferenceTextParser.extractURL(text) || ReferenceTextParser.identifiers2URL(identifiers),
          authors: gbt.authors,
          title: gbt.title,
          year: gbt.year,
          type: gbt.type as any,
          publicationVenue: gbt.source,
          volume: gbt.volume,
          issue: gbt.issue,
          pages: gbt.pages,
          text: text
        };
      }
    }

    return {
      identifiers: identifiers,
      url: ReferenceTextParser.extractURL(text) || ReferenceTextParser.identifiers2URL(identifiers),
      authors: [],
      ...ReferenceTextParser.parseRefText(text),
      type: (identifiers.arXiv ? "preprint" : "journalArticle")
    };
  }

  public static parseCNKIURL(cnkiURL: string) {
    try {
      const fileName = cnkiURL.match(/fileName=(\w+)/i)![1];
      const dbName = cnkiURL.match(/dbName=(\w+)/i)![1];
      const dbCode = cnkiURL.match(/dbCode=(\w+)/i)![1];
      return { fileName, dbName, dbCode };
    } catch {}
  }

  public static splitCreator(authorStr: string): any {
    const trimmed = authorStr.trim();
    if (!trimmed) return { creatorType: "author", name: "Unknown" };

    if (trimmed.includes(",")) {
      const parts = trimmed.split(",");
      const lastName = parts[0].trim();
      const firstName = parts.slice(1).join(",").trim();
      return { creatorType: "author", lastName, firstName: firstName || undefined };
    }

    const parts = trimmed.split(/\s+/);
    if (parts.length > 1) {
      const lastName = parts[parts.length - 1];
      const firstName = parts.slice(0, parts.length - 1).join(" ");
      return { creatorType: "author", lastName, firstName: firstName || undefined };
    }

    return { creatorType: "author", lastName: trimmed, firstName: undefined };
  }

  public static isChinese(text: string): boolean {
    return /[\u4e00-\u9fa5]/.test(text);
  }

  public static isDOI(text: string): boolean {
    if (!text || /(cnki|issn)/i.test(text)) return false;
    return REF_REGEX.DOI.test(text);
  }

  public static matchArXiv(text: string) {
    return text.match(REF_REGEX.arXiv);
  }

  public static Html2Text(html: string): string {
    return html.replace(/<[^>]+>/g, "");
  }
}

export default ReferenceTextParser;
