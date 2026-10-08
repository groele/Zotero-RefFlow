import Requests from "./requests";
import CitationVerifier, { CandidateWork } from "./verifier";

export interface OpenAlexWorkSummary {
  openalexId: string;
  doi?: string;
  title: string;
  authors: string[];
  year?: string;
  venue?: string;
  isOA: boolean;
  oaUrl?: string;
  citationCount?: number;
  isRetracted?: boolean;
}

export class OpenAlexProvider {
  private requests: Requests;

  constructor(requests?: Requests) {
    this.requests = requests || new Requests();
  }

  private get(url:string) {
    const key=String(Zotero.Prefs.get("refnexus.openAlexKey")||"").trim();
    return this.requests.get(url,"json",key?{Authorization:`Bearer ${key}`} : {});
  }

  /**
   * 通过 DOI 获取 OpenAlex Work 对象及其引用的文献列表 (referenced_works)
   */
  async getWorkByDOI(doi: string): Promise<{ work: any; referencedWorks: string[] } | undefined> {
    const cleanDoi = doi.trim().toLowerCase().replace(/^https?:\/\/doi\.org\//i, "").replace(/^doi:\s*/i, "");
    const selectFields = "id,doi,title,authorships,publication_year,primary_location,open_access,best_oa_location,cited_by_count,is_retracted,referenced_works,related_works";
    const url = `https://api.openalex.org/works/doi:${encodeURIComponent(cleanDoi)}?select=${selectFields}`;
    const data = await this.get(url);
    if (!data || !data.id) return undefined;

    return {
      work: data,
      referencedWorks: Array.isArray(data.referenced_works) ? data.referenced_works : []
    };
  }

  /** Bounded citation/related snapshots. A truncated list is explicitly identified. */
  async getNeighborhood(doi:string,kind:"Citations"|"Related",signal?:AbortSignal):Promise<{references:ItemBaseInfo[];total:number;truncated:boolean}> {
    if(signal?.aborted)throw new Error("Cancelled");
    const base=await this.getWorkByDOI(doi);
    if(!base)throw new Error("OpenAlex work lookup failed");
    if(signal?.aborted)throw new Error("Cancelled");
    let works:any[]=[],total=0;
    const fields="id,doi,title,authorships,publication_year,primary_location,open_access,best_oa_location,cited_by_count,is_retracted";
    if(kind==="Related") {
      const summaries=await this.hydrateBatch((base.work.related_works||[]).slice(0,100));
      total=(base.work.related_works||[]).length;
      if(total && !summaries.length)throw new Error("OpenAlex related metadata unavailable"+(this.requests.lastFailure?`: HTTP ${this.requests.lastFailure.status} ${this.requests.lastFailure.message}`:""));
      const references=summaries.map(work=>({title:work.title,text:work.title,authors:work.authors,year:work.year,publicationVenue:work.venue,identifiers:work.doi?{DOI:work.doi}:{},url:work.doi?`https://doi.org/${work.doi}`:work.openalexId,oaUrl:work.oaUrl,isOA:work.isOA,citationCount:work.citationCount,sources:["OpenAlex"],retraction:work.isRetracted?{isRetracted:true,checked:true,reason:"OpenAlex retraction flag"}:undefined} as ItemBaseInfo));
      return {references,total,truncated:references.length<total};
    }
    const id=String(base.work.id).split("/").pop();let cursor="*";
    const deadline=Date.now()+25000;
    for(let page=0;page<5 && !signal?.aborted && Date.now()<deadline;page++) {
      const result=await this.get(`https://api.openalex.org/works?filter=${encodeURIComponent(`cites:${id}`)}&per_page=100&cursor=${encodeURIComponent(cursor)}&select=${fields}`);
      if(!Array.isArray(result?.results)){if(!works.length)throw new Error("OpenAlex citation request failed"+(this.requests.lastFailure?`: HTTP ${this.requests.lastFailure.status} ${this.requests.lastFailure.message}`:""));break;}
      total=Number(result.meta?.count||0);works.push(...result.results);cursor=result.meta?.next_cursor;
      if(!cursor || !result.results.length || works.length>=total)break;
    }
    const seen=new Set<string>();
    const references=works.filter(work=>!seen.has(work.id)&&Boolean(seen.add(work.id))).map(work=>{
      const doi=CitationVerifier.normalizeDOI(work.doi);const title=work.title||"Untitled";
      return {title,text:title,authors:(work.authorships||[]).map((a:any)=>a.author?.display_name).filter(Boolean),year:String(work.publication_year||""),publicationVenue:work.primary_location?.source?.display_name,identifiers:doi?{DOI:doi}:{},url:doi?`https://doi.org/${doi}`:work.id,isOA:Boolean(work.open_access?.is_oa),oaUrl:work.best_oa_location?.pdf_url||work.open_access?.oa_url,citationCount:work.cited_by_count,sources:["OpenAlex"],retraction:work.is_retracted?{isRetracted:true,checked:true,reason:"OpenAlex retraction flag"}:undefined} as ItemBaseInfo;
    });
    return {references,total,truncated:references.length<total};
  }

  /**
   * 批量高效水合 (Batch Hydration): 并发请求，单批50篇，并添加 select 字段瘦身 90%
   */
  async hydrateBatch(workUrls: string[]): Promise<OpenAlexWorkSummary[]> {
    if (!workUrls || workUrls.length === 0) return [];

    const cleanIds = [...new Set(workUrls
      .map(url => url.replace(/^https?:\/\/openalex\.org\//i, "").trim())
      .filter(id=>/^W\d+$/i.test(id)))];

    const chunks: string[][] = [];
    const chunkSize = 50;
    for (let i = 0; i < cleanIds.length; i += chunkSize) {
      chunks.push(cleanIds.slice(i, i + chunkSize));
    }

    const selectFields = "id,doi,title,authorships,publication_year,primary_location,open_access,best_oa_location,cited_by_count,is_retracted";

    // 并发执行所有 chunk 检索，极大缩减网络延迟
    const responses = await Promise.allSettled(
      chunks.map(chunk => {
        const filter = encodeURIComponent(`openalex:${chunk.join("|")}`);
        const url = `https://api.openalex.org/works?filter=${filter}&per-page=50&select=${selectFields}`;
        return this.get(url);
      })
    );

    const summaries: OpenAlexWorkSummary[] = [];

    for (const res of responses) {
      if (res.status === "fulfilled" && res.value && Array.isArray(res.value.results)) {
        for (const item of res.value.results) {
          const authors = (item.authorships || [])
            .map((a: any) => a.author?.display_name)
            .filter(Boolean);

          let doi = item.doi ? item.doi.replace(/^https?:\/\/doi\.org\//i, "").replace(/^doi:\s*/i, "") : undefined;
          const isOA = Boolean(item.open_access?.is_oa);
          const oaUrl = item.open_access?.oa_url || item.best_oa_location?.pdf_url || undefined;
          const isRetracted = Boolean(item.is_retracted);

          summaries.push({
            openalexId: item.id,
            doi,
            title: item.title || "Untitled",
            authors,
            year: item.publication_year ? String(item.publication_year) : undefined,
            venue: item.primary_location?.source?.display_name,
            isOA,
            oaUrl,
            citationCount: item.cited_by_count,
            isRetracted
          });
        }
      }
    }

    // Preserve the provider's order; it need not equal the PDF bibliography order.
    const idOrderMap = new Map<string, number>();
    cleanIds.forEach((id, idx) => idOrderMap.set(id.toLowerCase(), idx));
    summaries.sort((a, b) => {
      const cleanA = a.openalexId.replace(/^https?:\/\/openalex\.org\//i, "").toLowerCase();
      const cleanB = b.openalexId.replace(/^https?:\/\/openalex\.org\//i, "").toLowerCase();
      return (idOrderMap.get(cleanA) ?? 99999) - (idOrderMap.get(cleanB) ?? 99999);
    });

    return summaries;
  }

  /**
   * 基于标题、作者与年份评分检索，低置信候选不自动采纳
   */
  async searchWorkByTitle(title: string, author?: string, year?: string): Promise<OpenAlexWorkSummary | undefined> {
    if (!title || title.trim().length < 5) return undefined;
    const cleanQuery = title.trim().slice(0, 100);
    const selectFields = "id,doi,title,authorships,publication_year,primary_location,open_access,best_oa_location,cited_by_count,is_retracted";
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(cleanQuery)}&per-page=3&select=${selectFields}`;
    const response = await this.get(url);

    if (response && Array.isArray(response.results) && response.results.length > 0) {
      for (const item of response.results) {
        const authors = (item.authorships || [])
          .map((a: any) => a.author?.display_name)
          .filter(Boolean);

        const cand: CandidateWork = {
          title: item.title || "",
          authors,
          year: item.publication_year ? String(item.publication_year) : undefined,
          doi: item.doi ? item.doi.replace(/^https?:\/\/doi\.org\//i, "") : undefined
        };

        const result = CitationVerifier.evaluate({ title, author, year }, cand);
        if (result.status === "ACCEPT") {
          return {
            openalexId: item.id,
            doi: cand.doi,
            title: item.title || title,
            authors,
            year: cand.year ? String(cand.year) : undefined,
            venue: item.primary_location?.source?.display_name,
            isOA: Boolean(item.open_access?.is_oa),
            oaUrl: item.open_access?.oa_url || item.best_oa_location?.pdf_url || undefined,
            citationCount: item.cited_by_count,
            isRetracted: Boolean(item.is_retracted)
          };
        }
      }
    }
    return undefined;
  }
}
export default OpenAlexProvider;
