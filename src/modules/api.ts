import Utils from "./utils";
import { config } from "../../package.json";
import Requests from "./requests";
import OpenAlexProvider from "./openalex";
import RetractionChecker from "./retraction";
import CitationVerifier from "./verifier";
import PublisherReferences from "./publisherReferences";
import type {ReferenceResult} from "./referenceRetrieval";
import SemanticScholarProvider from "./semanticScholar";
import {selectUniqueTitle} from "./titleResolution";

class API {
  private async optional<T>(work:(signal:AbortSignal)=>Promise<T>,timeoutMs:number,fallback:T,signal?:AbortSignal):Promise<T> {
    let timer:any;
    const controller=new AbortController();
    let release:()=>void=()=>{};
    const cancelled=new Promise<T>(resolve=>{release=()=>resolve(fallback);});
    const abort=()=>{controller.abort();release();};signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted){abort();signal.removeEventListener('abort',abort);return fallback;}
    try{return await Promise.race([work(controller.signal),cancelled,new Promise<T>(resolve=>{timer=globalThis.setTimeout(()=>{controller.abort();resolve(fallback);},timeoutMs);})]);}
    finally{globalThis.clearTimeout(timer);controller.abort();signal?.removeEventListener('abort',abort);}
  }
  public utils: Utils;
  public requests: Requests;
  public openAlex: OpenAlexProvider;
  public semanticScholar: SemanticScholarProvider;
  public publisherReferences=new PublisherReferences();
  public retractionChecker: RetractionChecker;
  public Info: { crossref: Function, connectedpapers: Function, readpaper: Function, semanticscholar: Function, unpaywall: Function, arXiv: Function };
  public BaseInfo: { readcube: Function };
  constructor(utils: Utils) {
    this.utils = utils;
    this.requests = new Requests();
    this.openAlex = new OpenAlexProvider(this.requests);
    this.semanticScholar = new SemanticScholarProvider(this.requests);
    this.retractionChecker = new RetractionChecker(this.requests);
    this.Info = {
      crossref: (item: any) => {
        const types: any = {
          "journal-article": "journalArticle",
          "report": "report",
          "posted-content": "preprint",
          "book-chapter": "bookSection"
        }
        let references: ItemBaseInfo[] = (Array.isArray(item.reference)?item.reference:[]).filter((reference:any)=>reference&&typeof reference==="object").map((item: any) => {
          let identifiers
          let url: string | undefined
          let text: string
          let textInfo: any = {}
          if (item.unstructured) {
            text = item.unstructured
            textInfo = this.utils.refText2Info(text)
          } else {
            const volume=item.volume?String(item.volume)+(item.issue?`(${item.issue})`:""):"";
            const pages=item["first-page"]?String(item["first-page"]):"";
            text=[item.author,item["article-title"],item["journal-title"],volume+(pages?(volume?": ":"")+pages:""),item.year?`(${item.year})`:"",item.DOI?`https://doi.org/${item.DOI}`:""].filter(Boolean).join(". ");
            if(!text)text=Object.entries(item).filter(([key])=>key!=="key").map(([key,value])=>`${key}: ${value}`).join("; ");
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
        const resolvedAuthors = (Array.isArray(item.author)?item.author:[]).filter(Boolean).map((i: any) => {
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

  async getDOIBaseInfo(DOI:string,signal?:AbortSignal):Promise<ItemBaseInfo|undefined> {
    return this.getDOIInfoBySemanticscholar(DOI,signal);
  }

  async getDOIInfoBySemanticscholar(DOI:string,signal?:AbortSignal):Promise<ItemInfo|undefined> {
    const paper=await this.semanticScholar.byDOI(DOI,signal);
    return paper?this.semanticScholar.toInfo(paper):undefined;
  }

  async getDOIReferenceListBySemanticScholar(DOI:string,signal?:AbortSignal):Promise<ReferenceResult|undefined> {
    return this.semanticScholar.neighborhood(DOI,"References",signal);
  }

  async getDOIReferencesBySemanticScholar(DOI:string,signal?:AbortSignal):Promise<ItemBaseInfo[]> {
    return (await this.getDOIReferenceListBySemanticScholar(DOI,signal))?.references || [];
  }
  async getDOIInfoByCrossref(DOI: string,signal?:AbortSignal): Promise<ItemInfo | undefined> {
    if(signal?.aborted)return undefined;
    const cleanDOI = CitationVerifier.normalizeDOI(DOI) || DOI.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "");

    // 1. 并发请求 Crossref Polite API 与 OpenAlex (保留 DOI 斜杠路径，符合 RFC 规范)
    const doiPath = cleanDOI.split("/").map(seg => encodeURIComponent(seg)).join("/");
    const crossrefUrl = `https://api.crossref.org/works/${doiPath}`;
    const [crossrefRes, openalexRes] = await Promise.allSettled([
      this.requests.get(crossrefUrl,"json",{},signal),
      this.optional(child=>this.openAlex.getWorkByDOI(cleanDOI,child),5000,undefined,signal)
    ]);
    if(signal?.aborted)return undefined;

    let crossrefData = crossrefRes.status === "fulfilled" ? crossrefRes.value?.message : undefined;
    const returnedDOI=CitationVerifier.normalizeDOI(crossrefData?.DOI);
    if(returnedDOI && returnedDOI!==CitationVerifier.normalizeDOI(cleanDOI)){
      ztoolkit.log("Ignoring conflicting Crossref parent DOI");crossrefData=undefined;
    }
    let openalexWork = openalexRes.status === "fulfilled" ? openalexRes.value : undefined;


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
        const ids=openalexWork.referencedWorks;
        openalexHydrated = await this.optional(child=>this.openAlex.hydrateBatch(ids,child),references.length?4000:10000,[],signal);
      } catch (e) {
        ztoolkit.log("OpenAlex hydration error:", e);
      }
    }

    if(signal?.aborted)return undefined;
    // 3. Preserve the provider's bibliography order. OpenAlex enriches matching
    // Crossref entries, but its unmatched records are never appended as if they
    // were part of the same ordered reference list.
    if (references.length === 0 && openalexHydrated.length > 0) {
      // OpenAlex graph order is a provider order, not printed citation numbering.
      references = openalexHydrated.map((oa, idx) => ({
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
      const byDOI=new Map<string,any>(),byTitle=new Map<string,any[]>();
      for(const work of openalexHydrated){
        const doi=CitationVerifier.normalizeDOI(work.doi);if(doi&&!byDOI.has(doi))byDOI.set(doi,work);
        const title=CitationVerifier.cleanTitle(work.title);if(title){const group=byTitle.get(title)||[];group.push(work);byTitle.set(title,group);}
      }
      // 用 OpenAlex 数据挂载 OA 全文链接、缺失 DOI 与共识证据。
      for (const ref of references) {
        const refDoi = CitationVerifier.normalizeDOI(ref.identifiers?.DOI);
        const exact=refDoi?byDOI.get(refDoi):undefined;
        const sameTitle=byTitle.get(CitationVerifier.cleanTitle(ref.title))||[];
        const candidates=sameTitle.length?sameTitle:(references.length*openalexHydrated.length<=250000?openalexHydrated:[]);
        const matches = exact?[exact]:candidates.filter(oa => {
          const oaDOI=CitationVerifier.normalizeDOI(oa.doi);
          if (refDoi && oaDOI) return refDoi===oaDOI;
          const titleKey=CitationVerifier.cleanTitle(oa.title);
          const contained=ref.text&&titleKey.length>=20&&CitationVerifier.cleanTitle(ref.text).includes(titleKey);
          const candidateTitle=ref.title || (contained?oa.title:"");
          return Boolean(candidateTitle && CitationVerifier.evaluate({title:candidateTitle,author:ref.authors?.[0],year:ref.year,doi:refDoi},
            {title:oa.title,authors:oa.authors,year:oa.year,doi:oaDOI}).status==="ACCEPT");
        });
        const identities=new Set(matches.map(work=>CitationVerifier.normalizeDOI(work.doi)||work.openalexId||CitationVerifier.cleanTitle(work.title)));
        const match=identities.size===1?matches[0]:undefined;

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
    let semanticPartial=false,semanticAvailable=false;
    if (references.length === 0 || isUnderpopulated) {
      try {
        const result = references.length
          ? await this.optional(child=>this.getDOIReferenceListBySemanticScholar(cleanDOI,child),5000,undefined,signal)
          : await this.getDOIReferenceListBySemanticScholar(cleanDOI,signal);
        semanticAvailable=Boolean(result);
        if(!references.length)semanticPartial=Boolean(result?.partial);
        if (result && result.references.length>references.length) {
          references = result.references;semanticPartial=Boolean(result.partial);
        }
      } catch (s2Err) {
        ztoolkit.log("Semantic Scholar references error:", s2Err);
      }
    }

    // Local retraction checks run after library matching, where the actual
    // Zotero item is available. Unmatched provider rows are metadata only.
    if(!crossrefData&&!openalexWork&&!references.length)return undefined;

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
    finalInfo.referenceExpected=Number(expectedCount)||references.length;
    const confirmedEmpty=Number(crossrefData?.["reference-count"])===0 && crossrefData?.["reference-count"]!==undefined
      || Array.isArray(openalexWork?.work?.referenced_works)&&openalexWork.work.referenced_works.length===0
      || semanticAvailable&&!semanticPartial;
    finalInfo.referencePartial=semanticPartial || references.length<Number(expectedCount) || (!references.length&&!confirmedEmpty);
    finalInfo.DOI = cleanDOI;
    return finalInfo;
  }

  /** Publisher HTML/JATS is requested only when index metadata is absent/incomplete. */
  async getReferenceList(DOI:string,url?:string,title?:string,signal?:AbortSignal):Promise<ReferenceResult> {
    if(signal?.aborted)return {references:[],source:"Online"};
    let info:ItemInfo|undefined;
    try{info=await this.getDOIInfoByCrossref(DOI,signal);}catch(error){ztoolkit.log("Index reference request failed; trying publisher",error);}
    const references=info?.references||[];
    if(signal?.aborted)return {references:[],source:"Online"};
    if(!references.length || info?.referencePartial) {
      const structured=await this.publisherReferences.getReferences(DOI,url||info?.url,title||info?.title,signal);
      if(structured.length>references.length)return {references:structured,source:structured[0].sources?.[0]||"Publisher",expected:info?.referenceExpected,partial:Boolean(info?.referenceExpected&&structured.length<info.referenceExpected)};
    }
    return {references,source:references[0]?.sources?.[0]||"Online",expected:info?.referenceExpected,partial:info?.referencePartial,
      status:references.length?(info?.referencePartial?"partial":"success"):!info||info.referencePartial?"unavailable":"empty"};
  }

  async getDOIRelatedArray(DOI:string,limit=20,signal?:AbortSignal):Promise<ItemBaseInfo[]|undefined> {
    return (await this.semanticScholar.neighborhood(DOI,"Citations",signal,limit))?.references;
  }
  // For arXiv
  async getArXivInfo(arXiv: string,signal?:AbortSignal) {
    const response = await this.requests.get(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arXiv)}`, "text",{},signal);
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
  async getTitleInfoByCrossref(title: string, author?: string, year?: string,signal?:AbortSignal): Promise<ItemInfo | undefined> {
    if (!title || title.trim().length < 5) return undefined;
    const cleanTitle = title.trim();
    const api = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(cleanTitle)}&rows=3`;
    let response = await this.requests.get(api,"json",{},signal);
    if(signal?.aborted)return;
    const items=Array.isArray(response?.message?.items)?response.message.items:[];
    const item=selectUniqueTitle<any>({title:cleanTitle,author,year},items.filter((item:any)=>item&&!['component','dataset'].includes(item.type)).map((item:any)=>({
      value:item,work:{title:Array.isArray(item.title)?item.title[0]:item.title,doi:item.DOI,
        authors:(Array.isArray(item.author)?item.author:[]).map((author:any)=>author?.family||author?.name).filter((name:any)=>typeof name==="string"),
        year:(item.published||item['published-print']||item['published-online'])?.['date-parts']?.[0]?.[0]}
    })));
    if(!item)return;
    const info=this.Info.crossref(item) as ItemInfo;
    info.identifiers.DOI=CitationVerifier.normalizeDOI(info.identifiers.DOI);
    return info;
  }

  /**
   * 联邦解析器：结合 Crossref 与 OpenAlex，通过多维校验矩阵拒绝低置信匹配
   */
  async resolveWork(title: string, author?: string, year?: string,signal?:AbortSignal): Promise<{ doi?: string; oaUrl?: string; info?: ItemInfo } | undefined> {
    if (!title || signal?.aborted) return undefined;

    const providers = [
      {name:"Crossref",run:async()=>{const info=await this.getTitleInfoByCrossref(title,author,year,signal);return info?{doi:info.identifiers.DOI,info}:undefined;}},
      {name:"OpenAlex",run:async()=>{const work=await this.openAlex.searchWorkByTitle(title,author,year,signal);return work?{doi:work.doi,oaUrl:work.oaUrl}:undefined;}},
      {name:"Semantic Scholar",run:async()=>{const paper=await this.semanticScholar.byTitle(title,author,year,signal);if(!paper)return;const info=this.semanticScholar.toInfo(paper);return {doi:info.identifiers.DOI,oaUrl:info.oaUrl,info};}}
    ];
    for(const provider of providers) {
      if(signal?.aborted)return;
      try {
        const result=await provider.run();
        if(signal?.aborted)return;
        const doi=CitationVerifier.normalizeDOI(result?.doi);
        if(doi)return {...result!,doi};
      }catch(error:any){
        if(error?.name==="AbortError"||signal?.aborted)throw error;
        ztoolkit.log(`${provider.name} title lookup failed; trying next provider`,error);
      }
    }
  }

  async getCNKIURL(keywords: string, slience: boolean = false, signal?: AbortSignal) {
    if (!slience) {
      (new ztoolkit.ProgressWindow("[Pending] API", {closeOtherProgressWindows: true}))
        .createLine({ text: `Get CNKI URL`, type: "default" })
        .show()
    }
    const query = {Platform:"",DBCode:"CFLS",KuaKuCode:"CJFQ,CDMD,CIPD,CCND,CISD,SNAD,BDZK,CCJD,CCVD,CJFN",
      QNode:{QGroup:[{Key:"Subject",Title:"",Logic:1,Items:[{Title:"主题",Name:"SU",Value:keywords,Operate:"%=",BlurType:""}],ChildItems:[]}]},CodeLang:"ch"};
    const form = {IsSearch:"true",QueryJson:JSON.stringify(query),PageName:"defaultresult",DBCode:"CFLS",CurPage:"1",RecordsCntPerPage:"20",
      CurDisplayMode:"listmode",CurrSortField:"",CurrSortFieldType:"desc",IsSentenceSearch:"false",Subject:""};
    const body = Object.entries(form).map(([key,value])=>`${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
    const res = await this.requests.post("https://kns.cnki.net/kns8/Brief/GetGridTableHtml",body,"text",{
      Accept:"text/html", "Content-Type":"application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With":"XMLHttpRequest"
    }, signal);
    if(signal?.aborted)return;
    try {
      if (typeof res === "string") {
        let cnkiMatch = res.match(/href='(.+FileName=.+?&DbName=.+?)'/i);
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

  async getTitleInfoByCNKI(refText: string, signal?:AbortSignal): Promise<ItemInfo | undefined> {
    // 拒绝非中文请求，避免被封IP
    if (signal?.aborted || !this.utils.isChinese(refText)) { return }
    let res = this.utils.parseRefText(refText)
    const key = `${res.title}${res.authors}${refText}`
    const cached = this.requests.getCache(key);
    if (cached) {
      return cached;
    }
    ztoolkit.log("parseRefText", refText, res)
    let url = await this.getCNKIURL(res.title, true,signal)
    if (!url || typeof url !== "string") { return }

    let htmlString = await this.requests.get(url, "text",{},signal)
    if(signal?.aborted || typeof htmlString!=="string")return;
    ztoolkit.log(url, htmlString)
    const parser = ztoolkit.getDOMParser();
    const doc = parser.parseFromString(htmlString, "text/html").documentElement as any;
    let aTags = doc.querySelectorAll(".top-tip span a")
    const informSpan = [...doc.querySelectorAll("p.total-inform span")].find(span => span.innerText.includes("下载"));
    const downloadMatch = informSpan?.innerText?.match(/\d+/);
    const downloadCount = downloadMatch ? downloadMatch[0] : undefined;
    const returnedTitle=String(doc.querySelector(".brief h1")?.textContent||"").trim();
    const requestedTitle=CitationVerifier.cleanTitle(res.title);
    if(requestedTitle.length<6 || !returnedTitle || (requestedTitle!==CitationVerifier.cleanTitle(returnedTitle) && CitationVerifier.tokenJaccard(res.title,returnedTitle)<0.95))return;

    let info: ItemInfo = {
      identifiers: { CNKI: url },
      title: returnedTitle,
      abstract: doc.querySelector("span#ChDivSummary")?.innerText || "",
      authors: [...doc.querySelectorAll("#authorpart span a")].map((a: any) => a.innerText),
      type: "journalArticle",
      primaryVenue: aTags[0]?.innerText || "",
      year: aTags[1]?.innerText ? aTags[1].innerText.split(",")[0] : "",
      url: url,
      source: "CNKI",
      tags: [...doc.querySelectorAll(".keywords a")].map((a: any) => a.innerText.replace(/(\n|\s+|;)/g, ""))
        .concat(downloadCount!==undefined?[
          {
            text: downloadCount,
            color: "#cc7c08",
            tip: "知网下载量"
          }
        ]:[])
    }
    this.requests.setCache(key, info);
    return info
  }

  async getCNKIFileInfo(fileName: string, count=0, signal?:AbortSignal): Promise<ItemInfo | undefined> {
    if(signal?.aborted || !fileName)return;
    const prefsKey=`${config.addonRef}.CNKI.token`;
    const username=String(Zotero.Prefs.get(`${config.addonRef}.CNKI.username`)||"");
    const password=String(Zotero.Prefs.get(`${config.addonRef}.CNKI.password`)||"");
    let token=String(Zotero.Prefs.get(prefsKey)||"");
    const updateToken=async()=>{
      if(!username||!password||signal?.aborted)return false;
      const res=await this.requests.post("https://apix.cnki.net/databusapi/api/v1.0/credential/namepasswithcleartext/personalaccount",
        {Username:username,Password:password},"json",{},signal,{cache:false});
      if(signal?.aborted || typeof res?.Content!=="string" || !res.Content.trim())return false;
      token=res.Content.trim();Zotero.Prefs.set(prefsKey,token);return true;
    };
    if(!token && !await updateToken())return;
    const name=encodeURIComponent(fileName);
    const infoApi=`https://x.cnki.net/readApi/api/v1/paperInfo?fileName=${name}&tableName=CJFDTOTAL&dbCode=CJFD&from=ReadingHistory&type=psmc&fsType=1&taskId=0`;
    const refApi=`https://x.cnki.net/readApi/api/v1/paperRefreNotes?appId=CRSP_BASIC_PSMC&dbcode=CJFD&tablename=CJFDTOTAL&filename=${name}&type=1&page=1`;
    const infoData=await this.requests.get(infoApi,"json",{token},signal);
    if(signal?.aborted)return;
    const refData=await this.requests.get(refApi,"json",{token},signal);
    if(signal?.aborted)return;
    if(!refData || String(refData.code)!=="200") {
      // Renew only an explicit authentication rejection, once. Transport,
      // rate-limit and unknown vendor failures do not trigger repeated logins.
      const rejected=["401","403"].includes(String(refData?.code));
      if(rejected && count<1 && await updateToken())return this.getCNKIFileInfo(fileName,count+1,signal);
      return;
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
          const cnkiURL = `https://kns.cnki.net/kcms/detail/detail.aspx?FileName=${encodeURIComponent(_ref.fileName||"")}&DbName=${encodeURIComponent(_ref.tableName||"")}&DbCode=${encodeURIComponent(dbCode)}`;
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
          const cnkiURL = `https://kns.cnki.net/kcms/detail/detail.aspx?FileName=${encodeURIComponent(ref.fileName||"")}&DbName=${encodeURIComponent(ref.tableName||"")}&DbCode=${encodeURIComponent(dbCode)}`;
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
    // Vendor pagination is undocumented. Only the complete bibliography can
    // establish completeness; a first-page refer list remains partial.
    info.referencePartial=!Array.isArray(infoData?.content?.paper?.bibliography);
    if(signal?.aborted)return;
    return info
  }
}

export default  API

