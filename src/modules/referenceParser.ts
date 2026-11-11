import GBT7714Parser from "./parsers/gbt7714";
import WesternCitationParser from "./parsers/westernCitation";
import CitationVerifier from "./verifier";

export class ReferenceParser {
  public static regex = {
    DOI: /10\.\d{4,9}\/[-._;()/:A-Za-z0-9><]+[^\.\]]/,
    arXiv: /(?:arXiv[\.:\s]|arxiv\.org\/abs\/)(\d{4}\.\d{4,5}(?:v\d+)?|[a-z\-]+(?:\.[A-Z]{2})?\/\d{7})/i,
    URL: /https?:\/\/[^\s<>"'{}|\\^`]+/i
  };

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

    // 3. PMID 探测
    const pmidMatch = text.match(/\b(?:PMID|pmid)[\s:：]+(\d{6,9})\b/);
    if (pmidMatch) {
      (identifiers as any).PMID = pmidMatch[1];
    }

    // 4. PMCID 探测
    const pmcidMatch = text.match(/\b(PMC\d{6,8})\b/i);
    if (pmcidMatch) {
      (identifiers as any).PMCID = pmcidMatch[1].toUpperCase();
    }

    // 5. ISBN 探测
    const isbnMatch = text.match(/\b(?:ISBN(?:-1[03])?[\s:：]?)?((?:97[89][-\s]?)?(?:\d[-\s]?){9}[\dXx])\b/);
    if (isbnMatch) {
      const cleanISBN = isbnMatch[1].replace(/[-\s]/g, "");
      if (cleanISBN.length === 10 || cleanISBN.length === 13) {
        (identifiers as any).ISBN = cleanISBN;
      }
    }

    return identifiers;
  }

  public static extractURL(text: string): string | undefined {
    let res = text.match(this.regex.URL);
    if (res) {
      return res[0].replace(/[.,;:()\[\]]+$/, "");
    }
  }

  public static parseRefText(text: string): { year?: string; authors?: string[]; title: string; publicationVenue?: string } {
    try {
      text = text.replace(/^\[\d+?\]/, "");
      text = text.replace(/\s+/g, " ");
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
                let res = s.match(regex);
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

      let splitByTitle = text.split(titleMatch);
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
      let res = text.match(/[^\d]\d{4}[^\d-]/g)?.map(s => s.match(/\d+/)![0]);
      let year = res?.find(s => {
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

  public static _parseRefText(text: string): { year?: string; authors: string[]; title: string } {
    const res = this.parseRefText(text);
    return {
      year: res.year,
      authors: res.authors || [],
      title: res.title
    };
  }

  public static identifiers2URL(identifiers: ItemBaseInfo["identifiers"]) {
    let url: string | undefined;
    if (identifiers.DOI) {
      url = `https://doi.org/${identifiers.DOI}`;
    } else if (identifiers.arXiv) {
      url = `https://arxiv.org/abs/${identifiers.arXiv}`;
    } else if ((identifiers as any).PMID) {
      url = `https://pubmed.ncbi.nlm.nih.gov/${(identifiers as any).PMID}/`;
    } else if ((identifiers as any).PMCID) {
      url = `https://www.ncbi.nlm.nih.gov/pmc/articles/${(identifiers as any).PMCID}/`;
    }
    return url;
  }

  public static refText2Info(text: string): ItemBaseInfo {
    let identifiers = this.getIdentifiers(text);

    // 1. 优先采用国标 GB/T 7714 确定性解析
    if (GBT7714Parser.isGBT7714(text)) {
      const gbt = GBT7714Parser.parse(text);
      if (gbt) {
        if (gbt.doi) identifiers.DOI = CitationVerifier.normalizeDOI(gbt.doi);
        return {
          identifiers: identifiers,
          url: this.extractURL(text) || this.identifiers2URL(identifiers),
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

    // 2. 尝试英文主流引文格式 (IEEE / APA / Vancouver / MLA) 确定性解析
    const western = WesternCitationParser.parse(text);
    if (western) {
      if (western.doi && !identifiers.DOI) identifiers.DOI = western.doi;
      return {
        identifiers: identifiers,
        url: this.extractURL(text) || this.identifiers2URL(identifiers),
        authors: western.authors,
        title: western.title,
        year: western.year,
        type: "journalArticle",
        publicationVenue: western.publicationVenue,
        volume: western.volume,
        issue: western.issue,
        pages: western.pages,
        text: text
      };
    }

    // 3. 通用启发式切分
    const heuristic = this.parseRefText(text);
    return {
      identifiers: identifiers,
      url: this.extractURL(text) || this.identifiers2URL(identifiers),
      ...heuristic,
      authors: heuristic.authors || [],
      type: (identifiers.arXiv ? "preprint" : "journalArticle")
    };
  }

  public static parseCNKIURL(cnkiURL: string) {
    try {
      let fileName = cnkiURL.match(/fileName=(\w+)/i)![1];
      let dbName = cnkiURL.match(/dbName=(\w+)/i)![1];
      let dbCode = cnkiURL.match(/dbCode=(\w+)/i)![1];
      return { fileName, dbName, dbCode };
    } catch {}
  }

  /**
   * 将作者名称字符串拆分为符合 Zotero 规范的 firstName / lastName
   */
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
      return { creatorType: "author", lastName, firstName };
    }

    return { creatorType: "author", lastName: trimmed };
  }

  public static isChinese(text: string): boolean {
    text = text.replace(/\s+/g, "");
    return (text.match(/[\u4E00-\u9FA5]/g)?.length || 0) / text.length > 0.5;
  }

  public static isDOI(text: string): boolean {
    if (!text) return false;
    const clean = CitationVerifier.normalizeDOI(text);
    return Boolean(clean && !/(cnki|issn)/i.test(clean));
  }

  public static matchArXiv(text: string) {
    let res = text.match(this.regex.arXiv);
    if (res != null && res.length >= 2) {
      return res[1];
    } else {
      return false;
    }
  }

  public static Html2Text(html: string): string {
    if (!html) return "";
    let text = "";
    try {
      let span: HTMLSpanElement | null = document.createElement("span");
      span.innerHTML = html;
      text = span.innerText || span.textContent || "";
      span = null;
    } catch (e) {
      text = "";
    }
    if (!text) {
      text = html
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'");
    }
    return text.replace(/\n+/g, " ").trim();
  }
}

export default ReferenceParser;
