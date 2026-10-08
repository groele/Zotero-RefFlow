import Utils from "./utils";
import { config } from "../../package.json";
import Requests from "./requests";
import OpenAlexProvider from "./openalex";
import RetractionChecker from "./retraction";
import CitationVerifier from "./verifier";

class API {
  private async optional<T>(work:Promise<T>,timeoutMs:number,fallback:T):Promise<T> {
    let timer:any;
    try{return await Promise.race([work,new Promise<T>(resolve=>{timer=window.setTimeout(()=>resolve(fallback),timeoutMs);})]);}
    finally{window.clearTimeout(timer);}
  }
  public utils: Utils;
  public requests: Requests;
  public openAlex: OpenAlexProvider;
  public retractionChecker: RetractionChecker;
  public Info: { crossref: Function, connectedpapers: Function, readpaper: Function, semanticscholar: Function, unpaywall: Function, arXiv: Function };
  public BaseInfo: { readcube: Function };
  constructor(utils: Utils) {
    this.utils = utils;
    this.requests = new Requests();
    this.openAlex = new OpenAlexProvider(this.requests);
    this.retractionChecker = new RetractionChecker(this.requests);
    this.Info = {
      crossref: (item: any) => {
        const types: any = {
          "journal-article": "journalArticle",
          "report": "report",
          "posted-content": "preprint",
          "book-chapter": "bookSection"
        }
        let references: ItemBaseInfo[] = item.reference?.map((item: any) => {
          let identifiers
          let url: string | undefined
          let text: string
          let textInfo: any = {}
          if (item.unstructured) {
            text = item.unstructured
            textInfo = this.utils.refText2Info(text)
          } else {
            if (
              item["article-title"] &&
              item.year &&
              item.author
            ) {
              text = `${item.author} et al., ${item.year}, ${item["article-title"]}`
            } else {
              let textArray = []
              for (let key in item) {
                textArray.push(`${key}: ${item[key]}`)
              }
              text = textArray.join("; ")
            }
          }
          if (item.DOI) {
            identifiers = { DOI: item.DOI }
            url = this.utils.identifiers2URL(identifiers)
          }
          let info: ItemBaseInfo = {
            identifiers: identifiers || textInfo!.identifiers || {},
            title: item["article-title"] || textInfo?.title,
            authors: item?.author ? [item.author] : (textInfo?.authors || []),
            year: item.year || textInfo?.year,
            text: text,
            type: types[item.type] || textInfo?.type || "journalArticle",
            publicationVenue: item["journal-title"] || textInfo?.publicationVenue,
            url: textInfo?.url || url
          };
          return info;
        });

        const refCount = item["is-referenced-by-count"];
        const resolvedTitle = Array.isArray(item.title) ? item.title[0] : (item.title || "");
        const resolvedAuthors = item?.author?.map((i: any) => {
          return i.family ? (i.given ? `${i.given} ${i.family}` : i.family) : (i.name || "");
        }).filter(Boolean) || [];
        const resolvedYear = (item.published && item.published["date-parts"]?.[0]?.[0]) ||
          (item["published-print"] && item["published-print"]["date-parts"]?.[0]?.[0]) ||
          (item["published-online"] && item["published-online"]["date-parts"]?.[0]?.[0]) ||
          (item.created && item.created["date-parts"]?.[0]?.[0]);
        const resolvedVenue = Array.isArray(item["container-title"]) ? item["container-title"][0] : (item["container-title"] || "");

        let info: ItemInfo = {
          identifiers: { DOI: item.DOI },
          authors: resolvedAuthors,
          title: resolvedTitle,
          year: resolvedYear ? String(resolvedYear) : undefined,
          type: types[item.type] || "journalArticle",
          text: resolvedTitle,
          url: item.URL || (item.DOI ? `https://doi.org/${item.DOI}` : undefined),
          abstract: item.abstract,
          publishDate: item.published && item.published["date-parts"]?.[0]?.join("-"),
          source: item.source ? item.source.toLowerCase() : "crossref",
          primaryVenue: resolvedVenue,
          references: references,
          tags: [
            ...(refCount && refCount > 0 ? [{
              text: String(refCount),
              color: "#2fb8cb",
              tip: "is-referenced-by-count"
            }] : []),
          ]
        };
        return info;
      },
      connectedpapers: (item: any) => {
        let info: ItemInfo = {
          identifiers: { DOI: item.doiInfo.doi },
          authors: item?.authors?.map((i: any) => i[0].name),
          title: item.title.text,
          year: item.year.text,
          type: "journalArticle",
          text: item.title.text,
          url: item.doiInfo.doiUrl,
          abstract: item.paperAbstract.text,
          source: "connectedpapers",
          primaryVenue: item.venue.text,
          references: [],
          tags: [
            { text: item.citationStats.numCitations, tip: "citationStats.numCitations", color: "rgba(53, 153, 154, 0.5)" },
            { text: item.citationStats.numReferences, tip: "citationStats.numReferences", color: "rgba(53, 153, 154, 0.75)" }
          ]
        }
        return info
      },
      readpaper: (data: any) => {
        let info: ItemInfo = {
          identifiers: {},
          title: this.utils.Html2Text(data.title) as string,
          year: data.year,
          publishDate: data.publishDate,
          authors: data?.authorList.map((i: any) => this.utils.Html2Text(i.name)),
          abstract: this.utils.Html2Text(data.summary) as string,
          primaryVenue: this.utils.Html2Text(data.primaryVenue) as string,
          tags: [
            ...(data.venueTags || []),
            ...(
              data.citationCount && data.citationCount > 0 ?
                [
                  {
                    text: data.citationCount,
                    tip: "citationCount",
                    color: "#1f71e0"
                  }
                ] : []
            )
          ],
          source: "readpaper",
          type: "journalArticle"
        }
        return info
      },
      semanticscholar(data: any) {
        let info: ItemInfo = {
          identifiers: { DOI: data.DOI },
          title: data.title,
          authors: (data.authors || []).map((i: any) => i.name),
          year: data.year,
          publishDate: data.publicationDate,
          abstract: data.abstract,
          source: "semanticscholar",
          type: "journalArticle",
          tags: data.fieldsOfStudy || [],
          primaryVenue: data.journal?.name,
          url: data.DOI ? `https://doi.org/${data.DOI}` : undefined
        }
        return info
      },
      unpaywall(data: any) {
        const types: any = {
          "journal-article": "journalArticle",
          "report": "report",
          "posted-content": "preprint",
          "book-chapter": "bookSection"
        }
        let info: ItemInfo = {
          identifiers: { DOI: data.DOI },
          authors: (data.z_authors || []).map((i: any) => i.family),
          title: data.title,
          year: data.year,
          type: types[data.genre],
          primaryVenue: data.journal_name,
          source: "unpaywall",
          publishDate: data.published_date,
          abstract: undefined
        }
        return info
      },
      arXiv: (data: any) => {
        const rawTitle = Array.isArray(data.title) ? data.title[0] : (data.title || "");
        const rawSummary = Array.isArray(data.summary) ? data.summary[0] : (data.summary || "");
        const authors = Array.isArray(data.author)
          ? data.author.map((e: any) => Array.isArray(e.name) ? e.name[0] : (e.name || ""))
          : [];
        const categories = Array.isArray(data.category)
          ? data.category.map((e: any) => e["$"]?.term).filter(Boolean)
          : [];

        let info: ItemInfo = {
          identifiers: { arXiv: data.arXiv },
          title: rawTitle.replace(/\n/g, " ").trim(),
          year: data.year,
          authors: authors,
          abstract: rawSummary.replace(/\n/g, " ").trim(),
          url: this.utils.identifiers2URL({ arXiv: data.arXiv }),
          type: "preprint",
          tags: categories,
          publishDate: Array.isArray(data.published) ? data.published[0] : data.published,
          primaryVenue: data["arxiv:comment"] && data["arxiv:comment"][0]?.["_"] ? data["arxiv:comment"][0]["_"].replace(/\n/g, " ").trim() : undefined
        };
        return info;
      }
    }
    this.BaseInfo = {
      readcube: (data: any) => {
        let identifiers
        if (data.doi && this.utils.regex.arXiv.test(data.doi)) {
          data.arxiv = data.doi.match(this.utils.regex.arXiv).slice(-1)[0]
          data.doi = undefined
        }
        let type = "journalArticle"
        if (data.arxiv && !data.doi) {
          identifiers = { arXiv: data.arxiv }
          type = "preprint"
        } else {
          identifiers = { DOI: data.doi }
        }
        let url = this.utils.identifiers2URL(identifiers)
        let related: ItemBaseInfo = {
          identifiers: identifiers,
          title: data.title,
          authors: data?.authors,
          year: data.year,
          type: type,
          text: data.title,
          url: url
        }
        return related
      }
    }
  }

  // For DOI
  async getDOIBaseInfo(DOI: string): Promise<ItemBaseInfo | undefined> {
    const routes: any = {
      semanticscholar: `https://api.semanticscholar.org/graph/v1/paper/${DOI}?fields=title,year,authors`
    }
    for (let route in routes) {
      let response = await this.requests.get(routes[route])
      if (response) {
        response.DOI = DOI
        return this.Info[route as keyof typeof this.Info](response) as ItemBaseInfo
      }
    }
  }

  /**
   * From semanticscholar API
   * @param DOI 
   */
  async getDOIInfoBySemanticscholar(DOI: string): Promise<ItemInfo | undefined> {
    const api = `https://api.semanticscholar.org/graph/v1/paper/${DOI}?fields=title,authors,abstract,year,journal,fieldsOfStudy,publicationVenue,publicationDate`
    let response = await this.requests.get(api)
    if (response) {
      response.DOI = DOI
      if (!response.abstract) {
        // 可能是摘要太长，打开网页版获取
        let text = await this.requests.get(
          `https://www.semanticscholar.org/paper/${response.paperId}`,
          "text/html"
        )
        let parser = ztoolkit.getDOMParser()
        let doc = parser.parseFromString(text, "text/html")
        const abstract = doc.head.querySelector("meta[name=description]")?.getAttribute("content")
        if (!abstract?.startsWith("Semantic Scholar")) {
          response.abstract = abstract
        }
      }
      return this.Info.semanticscholar(response)
    }
  }

  /**
   * 从 Semantic Scholar Academic Graph 获取参考文献列表 (作为 Tier A 知识图谱兜底补全)
   */
  async getDOIReferencesBySemanticScholar(DOI: string): Promise<ItemBaseInfo[]> {
    const cleanDoi = DOI.trim().replace(/^https?:\/\/doi\.org\//i, "").replace(/^doi:\s*/i, "");
    const api = `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(cleanDoi)}/references?fields=title,authors,year,venue,externalIds&limit=100`;
    const response = await this.requests.get(api);
    if (!response || !Array.isArray(response.data)) return [];

    return response.data.map((item: any, idx: number) => {
      const cited = item.citedPaper || item;
      const authors = (cited.authors || []).map((a: any) => a.name).filter(Boolean);
      const doi = cited.externalIds?.DOI;
      const title = cited.title || "Untitled";
      return {
        number: idx + 1,
        title,
        authors,
        year: cited.year ? String(cited.year) : undefined,
        type: "journalArticle",
        publicationVenue: cited.venue,
        text: `${authors.join(", ")} (${cited.year || "n.d."}). ${title}. ${cited.venue || ""}`,
        identifiers: doi ? { DOI: doi } : {},
        url: doi ? `https://doi.org/${doi}` : undefined,
        sources: ["SemanticScholar"],
        confidence: doi ? 0.92 : 0.70
      };
    });
  }

  async getDOIInfoByCrossref(DOI: string): Promise<ItemInfo | undefined> {
    const cleanDOI = CitationVerifier.normalizeDOI(DOI) || DOI.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "");

    // 1. 并发请求 Crossref Polite API 与 OpenAlex (保留 DOI 斜杠路径，符合 RFC 规范)
    const doiPath = cleanDOI.split("/").map(seg => encodeURIComponent(seg)).join("/");
    const crossrefUrl = `https://api.crossref.org/works/${doiPath}`;
    const [crossrefRes, openalexRes] = await Promise.allSettled([
      this.requests.get(crossrefUrl),
      this.optional(this.openAlex.getWorkByDOI(cleanDOI),5000,undefined)
    ]);

    let crossrefData = crossrefRes.status === "fulfilled" ? crossrefRes.value?.message : undefined;
    let openalexWork = openalexRes.status === "fulfilled" ? openalexRes.value : undefined;

    let baseItem: any = crossrefData || openalexWork?.work;
    if (!baseItem) return undefined;

    let references: ItemBaseInfo[] = [];
    if (crossrefData && Array.isArray(crossrefData.reference)) {
      references = (this.Info.crossref(crossrefData).references || []).map((r: ItemBaseInfo, idx: number) => ({
        ...r,
        number: r.number || (idx + 1),
        sources: ["Crossref"],
        confidence: r.identifiers?.DOI ? 0.95 : 0.65
      }));
    }

    // 2. 批量水合 OpenAlex 引文 (Batch Hydration)
    let openalexHydrated: any[] = [];
    if (openalexWork && openalexWork.referencedWorks && openalexWork.referencedWorks.length > 0) {
      try {
        openalexHydrated = await this.optional(this.openAlex.hydrateBatch(openalexWork.referencedWorks),references.length?4000:10000,[]);
      } catch (e) {
        ztoolkit.log("OpenAlex hydration error:", e);
      }
    }

    // 3. Preserve the provider's bibliography order. OpenAlex enriches matching
    // Crossref entries, but its unmatched records are never appended as if they
    // were part of the same ordered reference list.
    if (references.length === 0 && openalexHydrated.length > 0) {
      // Crossref 无引文，用 OpenAlex 补齐并保持其在原著中的引用次序
      references = openalexHydrated.map((oa, idx) => ({
        number: idx + 1,
        title: oa.title,
        authors: oa.authors,
        year: oa.year,
        type: "journalArticle",
        text: `${(oa.authors || []).join(", ")} (${oa.year || "n.d."}). ${oa.title}. ${oa.venue || ""}`,
        identifiers: oa.doi ? { DOI: oa.doi } : {},
        url: oa.doi ? `https://doi.org/${oa.doi}` : undefined,
        sources: ["OpenAlex"],
        confidence: oa.doi ? 0.94 : 0.70,
        isOA: oa.isOA,
        oaUrl: oa.oaUrl,
        retraction: oa.isRetracted ? { isRetracted: true, reason: "Retracted work flagged by OpenAlex" } : undefined
      }));
    } else if (openalexHydrated.length > 0) {
      // 用 OpenAlex 数据挂载 OA 全文链接、缺失 DOI 与共识证据。
      for (const ref of references) {
        const refDoi = CitationVerifier.normalizeDOI(ref.identifiers?.DOI);
        const match = openalexHydrated.find(oa => {
          const oaDOI=CitationVerifier.normalizeDOI(oa.doi);
          if (refDoi && oaDOI) return refDoi===oaDOI;
          if (ref.title && oa.title && CitationVerifier.tokenJaccard(ref.title, oa.title) >= 0.80) return true;
          const titleKey=CitationVerifier.cleanTitle(oa.title);
          if (ref.text && titleKey.length>=20 && CitationVerifier.cleanTitle(ref.text).includes(titleKey)) return true;
          return false;
        });

        if (match) {
          if (!ref.identifiers?.DOI && match.doi) {
            ref.identifiers = ref.identifiers || {};
            ref.identifiers.DOI = match.doi;
            ref.url = `https://doi.org/${match.doi}`;
          }
          if (!ref.title || ref.title.length < match.title.length) {
            ref.title = match.title;
          }
          if ((!ref.authors || ref.authors.length === 0) && match.authors?.length > 0) {
            ref.authors = match.authors;
          }
          ref.isOA = match.isOA;
          ref.oaUrl = match.oaUrl;
          if (match.isRetracted) {
            ref.retraction = { isRetracted: true, reason: "Retracted work flagged by OpenAlex" };
          }
          ref.sources = Array.from(new Set([...(ref.sources || ["Crossref"]), "OpenAlex"]));
          ref.confidence = 0.95; // Heuristic matching score, not a calibrated probability.
        }
      }

    }

    // 4. 完整度检验 (Completeness Check) 与 Semantic Scholar 兜底
    // 若 Crossref/OpenAlex 均未收录，或收录数量显著低于论文预期引用数时，启用 Semantic Scholar
    const expectedCount = (crossrefData && crossrefData["reference-count"]) || (openalexWork?.referencedWorks?.length) || 0;
    const isUnderpopulated = expectedCount >= 10 && references.length < expectedCount * 0.6;

    if (isUnderpopulated) {
      ztoolkit.log("Reference metadata is incomplete; preserving the primary provider's order instead of mixing lists", {
        expectedCount,
        extractedCount: references.length
      });
    }
    if (references.length === 0) {
      try {
        const s2Refs = await this.getDOIReferencesBySemanticScholar(cleanDOI);
        if (s2Refs && s2Refs.length > 0) {
          references = s2Refs;
        }
      } catch (s2Err) {
        ztoolkit.log("Semantic Scholar references error:", s2Err);
      }
    }

    // 5. 执行撤稿观察与学术诚信检查 (基于 Zotero 本地库极速匹配，0 网络时延)
    for (const ref of references) {
      if (ref.identifiers?.DOI && !ref.retraction?.isRetracted) {
        const retStatus = this.retractionChecker.checkLocal(ref.identifiers.DOI,ref._item);
        if (retStatus.isRetracted) {
          ref.retraction = retStatus;
        }
      }
    }

    let finalInfo: ItemInfo = crossrefData ? this.Info.crossref(crossrefData) : {
      identifiers: { DOI: cleanDOI },
      title: openalexWork?.work?.title || "Untitled",
      authors: (openalexWork?.work?.authorships || []).map((a: any) => a.author?.display_name),
      year: openalexWork?.work?.publication_year ? String(openalexWork.work.publication_year) : undefined,
      type: "journalArticle",
      text: openalexWork?.work?.title || "",
      references: []
    };

    finalInfo.references = references;
    finalInfo.DOI = cleanDOI;
    return finalInfo;
  }

  async getDOIRelatedArray(DOI: string, limit: number = 20): Promise<ItemBaseInfo[] | undefined> {
    const cleanDoi = DOI.trim().replace(/^https?:\/\/doi\.org\//i, "");
    // 使用官方免费公开的 Semantic Scholar Academic Graph API
    const api = `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(cleanDoi)}/citations?fields=title,authors,year,venue,externalIds&limit=${limit}`;
    let response = await this.requests.get(api);
    if (response && Array.isArray(response.data)) {
      return response.data.map((item: any) => {
        const citing = item.citingPaper || item;
        const authors = (citing.authors || []).map((a: any) => a.name);
        const doi = citing.externalIds?.DOI;
        return {
          title: citing.title || "Untitled",
          identifiers: doi ? { DOI: doi } : {},
          year: citing.year ? String(citing.year) : undefined,
          text: citing.title || "Untitled",
          type: "journalArticle",
          authors: authors,
          url: doi ? `https://doi.org/${doi}` : undefined
        };
      });
    }
  }

  /**
   * API失效
   */
  async _getDOIRelatedArray(DOI: string, limit: number = 20): Promise<ItemBaseInfo[] | undefined> {
    let res = await this.requests.get(
      `https://rest.connectedpapers.com/id_translator/doi/${DOI}`,
      "json",
      {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 e/107.0.0.0 Safari/537.36"
      }
    );
    if (!res || !res.paperId) return undefined;
    const api = `https://www.semanticscholar.org/api/1/search/paper/${res.paperId}/citations`
    let response = await this.requests.post(api, {
      "page": 1,
      "pageSize": 20,
      "sort": "relevance",
      "authors": [],
      "coAuthors": [],
      "venues": [],
      "yearFilter": null,
      "requireViewablePdf": false,
      "fieldsOfStudy": [],
      "useS2FosFields": true
    })
    ztoolkit.log(response)
    if (response) {
      let arr: ItemInfo[] = response.results.map((i: any) => {
        let info: ItemInfo = {
          title: i.title.text,
          identifiers: {},
          year: i.year,
          text: i.title.text,
          type: "journalArticle",
          authors: i.authors.map((e: any) => e[1].text),
        }
        if (i.citationContexts?.length > 0) {
          let descriptions: string[] = []
          i.citationContexts.slice(0, 1).forEach((ctx: any) => {
            try {
              descriptions.push(
                `${ctx.intents.length > 0 ? ctx.intents[0].id : "unknown"}: ${i.citationContexts[0].context.text}`
              )
            } catch {
              ztoolkit.log(ctx)
            }
          })
          info.description = descriptions.join("\n")
        }
        return info
      })
      return arr
    }
  }
  // For arXiv
  async getArXivInfo(arXiv: string) {
    const response = await this.requests.get(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arXiv)}`, "text");
    if (!response) return;
    const xml = ztoolkit.getDOMParser().parseFromString(String(response), "application/xml");
    if (xml.querySelector("parsererror")) throw new Error("Invalid arXiv metadata response");
    const entry = xml.getElementsByTagNameNS("http://www.w3.org/2005/Atom", "entry")[0];
    if (!entry || entry.querySelector("id")?.textContent?.includes("/errors")) return;
    const text = (name: string) => entry.getElementsByTagNameNS("http://www.w3.org/2005/Atom", name)[0]?.textContent?.replace(/\s+/g, " ").trim() || "";
    const published = text("published");
    return this.Info.arXiv({ arXiv, title: text("title"), summary: text("summary"), published, year:published.slice(0,4),
      author: [...entry.getElementsByTagNameNS("http://www.w3.org/2005/Atom", "author")].map(author => ({name:author.getElementsByTagNameNS("http://www.w3.org/2005/Atom", "name")[0]?.textContent || ""})),
      category: [...entry.getElementsByTagNameNS("http://www.w3.org/2005/Atom", "category")].map(category => ({"$":{term:category.getAttribute("term")}})) });
  }

  // For title
  /**
   * From crossref
   * @param title 
   * @returns 
   */
  async getTitleInfoByCrossref(title: string, author?: string, year?: string): Promise<ItemInfo | undefined> {
    if (!title || title.trim().length < 5) return undefined;
    const cleanTitle = title.trim();
    const api = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(cleanTitle)}&rows=3`;
    let response = await this.requests.get(api);
    if (response && response.message?.items) {
      const skipTypes = ["component", "dataset"];
      const items = response.message.items.filter((e: any) => !skipTypes.includes(e.type));
      for (const item of items) {
        const candTitle = Array.isArray(item.title) ? item.title[0] : item.title;
        const candAuthors = item?.author?.map((i: any) => i.family).filter(Boolean);
        const candYear = item.published && item.published["date-parts"]?.[0]?.[0];
        const candDOI = item.DOI;

        const evalResult = CitationVerifier.evaluate(
          { title: cleanTitle, author, year },
          { title: candTitle, authors: candAuthors, year: candYear, doi: candDOI }
        );

        if (evalResult.status === "ACCEPT") {
          let info = this.Info.crossref(item) as ItemInfo;
          return info;
        }
      }
    }
    return undefined;
  }

  async getTitleInfoByConnectedpapers(text: string): Promise<ItemInfo | undefined> {
    let title = text;
    if (this.utils.isDOI(text)) {
      let DOI = text;
      let res = await this.requests.get(
        `https://rest.connectedpapers.com/id_translator/doi/${encodeURIComponent(DOI)}`
      );
      title = res?.title || text;
    }
    const api = `https://rest.connectedpapers.com/search/${encodeURIComponent(title)}/1`;
    let response = await this.requests.post(api);
    if (response && response?.results?.length) {
      let item = response.results[0];
      let info = this.Info.connectedpapers(item) as ItemInfo;
      return info;
    }
  }

  /**
   * 联邦解析器：结合 Crossref 与 OpenAlex，通过多维校验矩阵拒绝低置信匹配
   */
  async resolveWork(title: string, author?: string, year?: string): Promise<{ doi?: string; oaUrl?: string; info?: ItemInfo } | undefined> {
    if (!title) return undefined;

    // 1. 尝试 Crossref 权威解析
    const crInfo = await this.getTitleInfoByCrossref(title, author, year);
    if (crInfo && crInfo.identifiers?.DOI) {
      return {
        doi: crInfo.identifiers.DOI,
        info: crInfo
      };
    }

    // 2. 尝试 OpenAlex 联邦检索
    const oaSummary = await this.openAlex.searchWorkByTitle(title, author, year);
    if (oaSummary && oaSummary.doi) {
      return {
        doi: oaSummary.doi,
        oaUrl: oaSummary.oaUrl
      };
    }

    return undefined;
  }
  
  async getTitleInfoByReadpaper(title: string, body: object = {}, doi: string | undefined = undefined): Promise<ItemInfo|undefined> {
    const api = "https://readpaper.com/api/microService-app-aiKnowledge/aiKnowledge/paper/search"
    let _body = {
      keywords: title,
      page: 1,
      pageSize: 1,
      searchType: Number(Object.values(body).length > 0)
    }
    body = { ..._body, ...body }

    let response = await this.requests.post(api, body)
    if (response && response?.data?.list?.[0]) {
      let data = response?.data?.list?.[0]
      // 验证DOI
      if (doi) {
        // 获取paperId的doi
        let _res = await this.requests.post(
          "https://readpaper.com/api/microService-app-aiKnowledge/aiKnowledge/paper/getPaperDetailInfo",
          { paperId: data.id }
        )
        const paperDoi = _res?.data?.doi;
        if (!paperDoi || paperDoi.toUpperCase() !== doi.toUpperCase()) {
          return undefined;
        }
      }
      let info = this.Info.readpaper(data) as ItemInfo
      if (doi) { info.identifiers = { DOI: doi }}
      return info
    }
  }

  // For CNKI
  async _getCNKIURL(title: string, author: string) {
    ztoolkit.log("getCNKIURL", title, author)
    let cnkiURL
    let oldFunc = Zotero.Jasminum.Scrape.getItemFromSearch
    Zotero.Jasminum.Scrape.getItemFromSearch = function (htmlString: string) {
      try {
        let res = htmlString.match(/href='(.+FileName=.+?&DbName=.+?)'/i) as any[]
        if (res.length) {
          return res[1]
        }
      } catch {
        return
      }
    }.bind(Zotero.Jasminum);
    cnkiURL = await Zotero.Jasminum.Scrape.search({ keyword: title })
    Zotero.Jasminum.Scrape.getItemFromSearch = oldFunc.bind(Zotero.Jasminum);
    if (!cnkiURL) {
      ztoolkit.log("cnkiURL", cnkiURL)
      return
    }
    let args = this.utils.parseCNKIURL(cnkiURL)
    if (args) {
      cnkiURL = `https://kns.cnki.net/kcms/detail/detail.aspx?FileName=${args.fileName}&DbName=${args.dbName}&DbCode=${args.dbCode}`
      return cnkiURL
    }
  }

  async getCNKIURL(keywords: string, slience: boolean = false) {
    if (!slience) {
      (new ztoolkit.ProgressWindow("[Pending] API", {closeOtherProgressWindows: true}))
        .createLine({ text: `Get CNKI URL`, type: "default" })
        .show()
    }
    const res = await Zotero.HTTP.request(
      "POST",
      "https://kns.cnki.net/kns8/Brief/GetGridTableHtml",
      {
        headers: {
          Accept: "text/html, */*; q=0.01",
          "Accept-Encoding": "gzip, deflate, br",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8,zh-TW;q=0.7",
          Connection: "keep-alive",
          "Content-Length": "2085",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Host: "kns.cnki.net",
          Origin: "https://kns.cnki.net",
          Referer:
            "https://kns.cnki.net/kns8/AdvSearch?dbprefix=SCDB&&crossDbcodes=CJFQ%2CCDMD%2CCIPD%2CCCND%2CCISD%2CSNAD%2CBDZK%2CCJFN%2CCCJD",
          "Sec-Fetch-Dest": "empty",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Site": "same-origin",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: `IsSearch=true&QueryJson={"Platform":"","DBCode":"CFLS","KuaKuCode":"CJFQ,CDMD,CIPD,CCND,CISD,SNAD,BDZK,CCJD,CCVD,CJFN","QNode":{"QGroup":[{"Key":"Subject","Title":"","Logic":1,"Items":[{"Title":"主题","Name":"SU","Value":"${keywords}","Operate":"%=","BlurType":""}],"ChildItems":[]}]},"CodeLang":"ch"}&PageName=defaultresult&DBCode=CFLS&CurPage=1&RecordsCntPerPage=20&CurDisplayMode=listmode&CurrSortField=&CurrSortFieldType=desc&IsSentenceSearch=false&Subject=`
      }
    )
    try {
      if (res && res.responseText) {
        let cnkiMatch = res.responseText.match(/href='(.+FileName=.+?&DbName=.+?)'/i);
        if (cnkiMatch && cnkiMatch[1]) {
          let args = this.utils.parseCNKIURL(cnkiMatch[1]);
          if (args) {
            return `https://kns.cnki.net/kcms/detail/detail.aspx?FileName=${args.fileName}&DbName=${args.dbName}&DbCode=${args.dbCode}`;
          }
        }
      }
    } catch { }
    if (!slience) {
      (new ztoolkit.ProgressWindow("[Pending] API", { closeOtherProgressWindows: true }))
        .createLine({ text: `Get CNKI URL Fail`, type: "fail" })
        .show()
    }
  }

  async getTitleInfoByCNKI(refText: string): Promise<ItemInfo | undefined> {
    // 拒绝非中文请求，避免被封IP
    if (!this.utils.isChinese(refText)) { return }
    let res = this.utils.parseRefText(refText)
    const key = `${res.title}${res.authors}${refText}`
    const cached = this.requests.getCache(key);
    if (cached) {
      return cached;
    }
    ztoolkit.log("parseRefText", refText, res)
    let url = await this.getCNKIURL(res.title, true)
    if (!url || typeof url !== "string") { return }

    let htmlString = await this.requests.get(url, "text")
    ztoolkit.log(url, htmlString)
    const parser = ztoolkit.getDOMParser();
    let doc = parser.parseFromString(htmlString, "text/html").childNodes[1] as any
    let aTags = doc.querySelectorAll(".top-tip span a")
    const informSpan = [...doc.querySelectorAll("p.total-inform span")].find(span => span.innerText.includes("下载"));
    const downloadMatch = informSpan?.innerText?.match(/\d+/);
    const downloadCount = downloadMatch ? downloadMatch[0] : "0";

    let info: ItemInfo = {
      identifiers: { CNKI: url },
      title: doc.querySelector(".brief h1")?.innerText || "",
      abstract: doc.querySelector("span#ChDivSummary")?.innerText || "",
      authors: [...doc.querySelectorAll("#authorpart span a")].map((a: any) => a.innerText),
      type: "journalArticle",
      primaryVenue: aTags[0]?.innerText || "",
      year: aTags[1]?.innerText ? aTags[1].innerText.split(",")[0] : "",
      url: url,
      source: "CNKI",
      tags: [...doc.querySelectorAll(".keywords a")].map((a: any) => a.innerText.replace(/(\n|\s+|;)/g, ""))
        .concat([
          {
            text: downloadCount,
            color: "#cc7c08",
            tip: "知网下载量"
          }
        ])
    }
    this.requests.setCache(key, info);
    return info
  }

  async getCNKIFileInfo(fileName: string, count: number=0): Promise<ItemInfo | undefined> {
    /**
     * 根据账号密码登录
     */
    const prefsKey = `${config.addonRef}.CNKI.token`
    const username = (Zotero.Prefs.get(`${config.addonRef}.CNKI.username`) as string) || "";
    const password = (Zotero.Prefs.get(`${config.addonRef}.CNKI.password`) as string) || "";
    if (username.length * password.length === 0) {
      (new ztoolkit.ProgressWindow("[Fail] API", { closeOtherProgressWindows: true }))
        .createLine({ text: "请配置知网研学账号密码后重试", type: "fail" })
        .show()
      return undefined;
    }
    let updateToken = async () => {
      function getRandomIP() {
        let ip: string = "";
        for (var i = 0; i < 4; i++) {
          //判断是否小于3，决定后面要不要拼接.
          if (i < 3) {
            ip = ip + String(Math.floor(Math.random() * 256)) + "."
          } else {
            ip = ip + String(Math.floor(Math.random() * 256))
          }
        }
        return ip
      }
      let res = await this.requests.post(
        "https://apix.cnki.net/databusapi/api/v1.0/credential/namepasswithcleartext/personalaccount",
        {
          Username: username,
          Password: password,
          Clientip: getRandomIP()
        }
      )
      const token = res.Content
      Zotero.Prefs.set(prefsKey, token)
    }
    const infoApi = `https://x.cnki.net/readApi/api/v1/paperInfo?fileName=${fileName}&tableName=CJFDTOTAL&dbCode=CJFD&from=ReadingHistory&type=psmc&fsType=1&taskId=0`
    const refApi = `https://x.cnki.net/readApi/api/v1/paperRefreNotes?appId=CRSP_BASIC_PSMC&dbcode=CJFD&tablename=CJFDTOTAL&filename=${fileName}&type=1&page=1`
    const userAgent = "user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36"
    const token = Zotero.Prefs.get(prefsKey) as string
    const infoData = await this.requests.get(infoApi, "json", {
      token: token,
      "user-agent": userAgent
    })
    // 这是最后一根救命稻草
    const refData = await this.requests.get(refApi, "json", {
      token: token,
      "user-agent": userAgent
    })
    ztoolkit.log(refData)
    if (!refData || String(refData.code) != "200") {
      if (count < 3) {
        await updateToken()
        return await this.getCNKIFileInfo(fileName, count + 1)
      } else {
        (new ztoolkit.ProgressWindow("[Fail] API", {closeOtherProgressWindows: true}))
          .createLine({ text: `${refData?.code || 'Error'}: ${refData?.promptMessage || '请求失败'}`, type: "fail" })
          .show()
        return undefined;
      }
    } 

    let info: ItemInfo = {
      identifiers: {},
      authors: [],
      type: "",
      references: [],
      title: ""
    }
    const typeMap: any = {
      "journal": "journalArticle"
    }
    if (String(infoData?.code) == "200" && infoData?.content?.paper?.bibliography) {
      const bibList = Array.isArray(infoData.content.paper.bibliography) ? infoData.content.paper.bibliography : [];
      const refList = Array.isArray(refData?.content?.refer) ? refData.content.refer : [];
      bibList.forEach((ref: {title: string}) => {
        let _ref = refList.find((_r: {title: string}) => {
          return Boolean(ref?.title && _r?.title && ref.title.indexOf(_r.title) != -1);
        });
        const refText = (ref?.title || "").replace(/^\[\d+\]/, "");
        if (_ref) {
          const dbCode = (_ref.dbSource || "").split("_")[0];
          const cnkiURL = `https://kns.cnki.net/kcms/detail/detail.aspx?FileName=${_ref.fileName}&DbName=${_ref.tableName}&DbCode=${dbCode}`;
          info.references?.push({
            identifiers: {
              CNKI: cnkiURL
            },
            text: refText,
            title: _ref.title,
            authors: [],
            type: typeMap[_ref.type] || "journalArticle",
            url: cnkiURL
          });
        } else {
          info.references?.push({
            identifiers: {},
            text: refText,
            authors: [],
            type: "journalArticle",
            title: refText
          });
        }
      });
    } else if (Array.isArray(refData?.content?.refer)) {
      const referList = [...refData.content.refer];
      referList.sort((a: any, b: any) => Number(a.citationNumber || 0) - Number(b.citationNumber || 0))
        .forEach((ref: any) => {
          const title = (ref.title || "").replace(/^\[\d+\]/, "");
          const dbCode = (ref.dbSource || "").split("_")[0];
          const cnkiURL = `https://kns.cnki.net/kcms/detail/detail.aspx?FileName=${ref.fileName}&DbName=${ref.tableName}&DbCode=${dbCode}`;
          const authors = typeof ref.author === "string" ? ref.author.split(";").filter((s: string) => s.length) : [];
          info.references?.push({
            identifiers: {
              CNKI: cnkiURL
            },
            authors: authors,
            type: typeMap[ref.type] || "journalArticle",
            text: `${ref.author || ""}. ${title}[${ref.type?.[0] || "J"}]. ${ref.source || ""}, ${ref.year || ""}, ${ref.volumn || ""}:${ref.pageNumber || ""}.`,
            title: ref.title,
            year: ref.year,
            url: cnkiURL,
            number: Number(ref.citationNumber || 0)
          });
        });
    }
    return info
  }
}

export default  API

