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
import createProviderMappers from './apiMappers';
import CNKIProvider from './cnkiProvider';

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
  public cnki: CNKIProvider;
  public Info: { crossref: Function, connectedpapers: Function, readpaper: Function, semanticscholar: Function, unpaywall: Function, arXiv: Function };
  public BaseInfo: { readcube: Function };
  constructor(utils: Utils) {
    this.utils = utils;
    this.requests = new Requests();
    this.openAlex = new OpenAlexProvider(this.requests);
    this.semanticScholar = new SemanticScholarProvider(this.requests);
    this.retractionChecker = new RetractionChecker(this.requests);
    this.cnki = new CNKIProvider(this.requests, this.utils);
    const mappers = createProviderMappers(this.utils);
    this.Info = mappers.Info;
    this.BaseInfo = mappers.BaseInfo;
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
    const crossrefLoss=references[0]?.sources?.[0]==='Crossref'&&Array.isArray(crossrefData?.reference)&&this.Info.crossref(crossrefData).references.length<crossrefData.reference.length;
    finalInfo.referencePartial=Boolean(crossrefLoss)||semanticPartial || references.length<Number(expectedCount) || (!references.length&&!confirmedEmpty);
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

  async getCNKIURL(keywords: string, silent: boolean = false, signal?: AbortSignal) {
    return this.cnki.getCNKIURL(keywords, silent, signal);
  }

  async getTitleInfoByCNKI(refText: string, signal?: AbortSignal): Promise<ItemInfo | undefined> {
    return this.cnki.getTitleInfoByCNKI(refText, signal);
  }

  async getCNKIFileInfo(fileName: string, count = 0, signal?: AbortSignal): Promise<ItemInfo | undefined> {
    return this.cnki.getCNKIFileInfo(fileName, count, signal);
  }
}

export default  API

