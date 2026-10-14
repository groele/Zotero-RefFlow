import Requests from "./requests";
import CitationVerifier from "./verifier";
import {OperationBudget} from "./operationBudget";
import {selectUniqueTitle} from "./titleResolution";

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

  private get(url:string,signal?:AbortSignal) {
    const key=String(Zotero.Prefs.get("refflow.openAlexKey")||"").trim();
    return this.requests.get(url,"json",key?{Authorization:`Bearer ${key}`} : {},signal);
  }

  private summarize(item:any):OpenAlexWorkSummary|undefined {
    const id=typeof item?.id==="string"?item.id.replace(/^https?:\/\/openalex\.org\//i,"").trim().toUpperCase():"";
    if(!/^W\d+$/.test(id)||typeof item.title!=="string"||!item.title.trim())return;
    return {openalexId:`https://openalex.org/${id}`,doi:CitationVerifier.normalizeDOI(item.doi),title:item.title,
      authors:(Array.isArray(item.authorships)?item.authorships:[]).map((author:any)=>author?.author?.display_name).filter((name:any)=>typeof name==="string"),
      year:item.publication_year?String(item.publication_year):undefined,venue:item.primary_location?.source?.display_name,
      isOA:Boolean(item.open_access?.is_oa),oaUrl:item.best_oa_location?.pdf_url||item.open_access?.oa_url||undefined,
      citationCount:item.cited_by_count,isRetracted:Boolean(item.is_retracted)};
  }

  private toReference(work:OpenAlexWorkSummary):ItemBaseInfo {
    return {title:work.title,text:work.title,authors:work.authors,year:work.year,publicationVenue:work.venue,
      identifiers:work.doi?{DOI:work.doi}:{},url:work.doi?`https://doi.org/${work.doi}`:work.openalexId,
      oaUrl:work.oaUrl,isOA:work.isOA,citationCount:work.citationCount,sources:["OpenAlex"],
      retraction:work.isRetracted?{isRetracted:true,checked:true,reason:"OpenAlex retraction flag"}:undefined};
  }

  /**
   * 通过 DOI 获取 OpenAlex Work 对象及其引用的文献列表 (referenced_works)
   */
  async getWorkByDOI(doi: string,signal?:AbortSignal): Promise<{ work: any; referencedWorks: string[] } | undefined> {
    const cleanDoi = doi.trim().toLowerCase().replace(/^https?:\/\/doi\.org\//i, "").replace(/^doi:\s*/i, "");
    const selectFields = "id,doi,title,authorships,publication_year,primary_location,open_access,best_oa_location,cited_by_count,is_retracted,referenced_works,related_works";
    const url = `https://api.openalex.org/works/doi:${encodeURIComponent(cleanDoi)}?select=${selectFields}`;
    const data = await this.get(url,signal);
    if (!data || !data.id) return undefined;
    const returnedDOI=CitationVerifier.normalizeDOI(data.doi);
    if(returnedDOI && returnedDOI!==CitationVerifier.normalizeDOI(cleanDoi))throw new Error("OpenAlex returned a conflicting DOI");

    return {
      work: data,
      referencedWorks: Array.isArray(data.referenced_works) ? data.referenced_works : []
    };
  }

  /** Bounded citation/related snapshots. A truncated list is explicitly identified. */
  async getNeighborhood(doi:string,kind:"Citations"|"Related",signal?:AbortSignal,budgetMs=25000):Promise<{references:ItemBaseInfo[];total:number;truncated:boolean}> {
    const budget=new OperationBudget(signal,budgetMs);
    try {
    const checkCancelled=()=>{if(signal?.aborted){const error=new Error("Cancelled");error.name="AbortError";throw error;}};
    checkCancelled();
    const base=await budget.run(child=>this.getWorkByDOI(doi,child));
    checkCancelled();
    if(!base)throw new Error("OpenAlex work lookup failed"+(this.requests.lastFailure?`: HTTP ${this.requests.lastFailure.status} ${this.requests.lastFailure.message}`:""));
    const works:OpenAlexWorkSummary[]=[],seen=new Set<string>();let total=0;
    const fields="id,doi,title,authorships,publication_year,primary_location,open_access,best_oa_location,cited_by_count,is_retracted";
    if(kind==="Related") {
      if(!Array.isArray(base.work.related_works))throw new Error("OpenAlex related metadata unavailable");
      const summaries=await budget.run(child=>this.hydrateBatch(base.work.related_works.slice(0,100),child))||[];
      checkCancelled();
      total=base.work.related_works.length;
      if(total && !summaries.length)throw new Error("OpenAlex related metadata unavailable"+(this.requests.lastFailure?`: HTTP ${this.requests.lastFailure.status} ${this.requests.lastFailure.message}`:""));
      const references=summaries.map(work=>this.toReference(work));
      return {references,total,truncated:references.length<total};
    }
    const id=String(base.work.id).split("/").pop();let cursor="*",partial=false,hasMore=false;
    for(let page=0;page<5 && !budget.expired;page++) {
      const result=await budget.run(child=>this.get(`https://api.openalex.org/works?filter=${encodeURIComponent(`cites:${id}`)}&per_page=100&cursor=${encodeURIComponent(cursor)}&select=${fields}`,child));
      checkCancelled();
      if(!Array.isArray(result?.results)){if(!works.length)throw new Error("OpenAlex citation request failed"+(this.requests.lastFailure?`: HTTP ${this.requests.lastFailure.status} ${this.requests.lastFailure.message}`:""));partial=true;break;}
      const count=result.meta?.count;
      const knownTotal=Number.isSafeInteger(count)&&count>=0;
      if(knownTotal)total=count;else partial=true;
      for(const row of result.results){const work=this.summarize(row);if(!work){partial=true;continue;}
        if(seen.has(work.openalexId))continue;seen.add(work.openalexId);works.push(work);}
      const next=result.meta?.next_cursor;
      hasMore=Boolean(next)&&!(knownTotal&&works.length>=total);
      if(next===cursor&&hasMore){partial=true;break;}
      cursor=next;
      if(!hasMore || !result.results.length)break;
    }
    const references=works.map(work=>this.toReference(work));
    return {references,total,truncated:partial||hasMore||references.length<total||budget.expired};
    } finally {budget.dispose();}
  }

  /**
   * Batch ID hydration uses the current 100-ID API limit and selected fields.
   */
  async hydrateBatch(workUrls: string[],signal?:AbortSignal,budgetMs=25000): Promise<OpenAlexWorkSummary[]> {
    if (!workUrls || workUrls.length === 0 || signal?.aborted) return [];

    const cleanIds = [...new Set(workUrls
      .filter(url=>typeof url==="string")
      .map(url => url.replace(/^https?:\/\/openalex\.org\//i, "").trim().toUpperCase())
      .filter(id=>/^W\d+$/i.test(id)))];

    const chunks: string[][] = [];
    const chunkSize = 100;
    for (let i = 0; i < cleanIds.length; i += chunkSize) {
      chunks.push(cleanIds.slice(i, i + chunkSize));
    }

    const selectFields = "id,doi,title,authorships,publication_year,primary_location,open_access,best_oa_location,cited_by_count,is_retracted";

    const budget=new OperationBudget(signal,budgetMs);
    try {
    // Four producers bound promises and scheduler load even for large lists.
    const responses:any[]=[];let nextChunk=0;
    const worker=async()=>{
      while(nextChunk<chunks.length&&!budget.expired){
        const index=nextChunk++,chunk=chunks[index];
        const filter = encodeURIComponent(`openalex:${chunk.join("|")}`);
        const url = `https://api.openalex.org/works?filter=${filter}&per_page=100&select=${selectFields}`;
        try{responses[index]=await budget.run(child=>this.get(url,child));}
        catch(error){budget.checkCancelled();responses[index]=undefined;}
      }
    };
    await Promise.all(Array.from({length:Math.min(4,chunks.length)},worker));
    budget.checkCancelled();

    const summaries: OpenAlexWorkSummary[] = [];

    const requested=new Set(cleanIds),seen=new Set<string>();
    for (const res of responses) {
      if (res && Array.isArray(res.results)) {
        for (const item of res.results) {
          const summary=this.summarize(item);
          if(!summary)continue;
          const id=summary.openalexId.replace(/^https?:\/\/openalex\.org\//i,"");
          if(!requested.has(id)||seen.has(id))continue;
          seen.add(id);
          summaries.push(summary);
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
    } finally {budget.dispose();}
  }

  /**
   * 基于标题、作者与年份评分检索，低置信候选不自动采纳
   */
  async searchWorkByTitle(title: string, author?: string, year?: string,signal?:AbortSignal): Promise<OpenAlexWorkSummary | undefined> {
    if (!title || title.trim().length < 5 || signal?.aborted) return undefined;
    const cleanQuery = title.trim().slice(0, 100);
    const selectFields = "id,doi,title,authorships,publication_year,primary_location,open_access,best_oa_location,cited_by_count,is_retracted";
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(cleanQuery)}&per-page=3&select=${selectFields}`;
    const response = await this.get(url,signal);

    if(signal?.aborted)return;
    const items=Array.isArray(response?.results)?response.results:[];
    const summaries=items.map((item:any)=>this.summarize(item)).filter((work:OpenAlexWorkSummary|undefined)=>Boolean(work)) as OpenAlexWorkSummary[];
    return selectUniqueTitle({title,author,year},summaries.map(work=>({value:work,id:work.openalexId,work})));
  }
}
export default OpenAlexProvider;
