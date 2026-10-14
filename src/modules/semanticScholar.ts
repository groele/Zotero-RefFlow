import Requests from "./requests";
import CitationVerifier from "./verifier";
import type { ReferenceResult } from "./referenceRetrieval";
import {OperationBudget} from "./operationBudget";
import {selectUniqueTitle} from "./titleResolution";

const FIELDS="paperId,title,authors,abstract,year,journal,fieldsOfStudy,externalIds,publicationVenue,publicationDate,citationCount,referenceCount,openAccessPdf";
export default class SemanticScholarProvider {
  constructor(private requests:Requests) {}
  private get(url:string,signal?:AbortSignal) {
    const key=String(Zotero.Prefs.get("refflow.semanticScholarKey") || "").trim();
    return this.requests.get(url,"json",key?{"x-api-key":key}:{},signal);
  }
  private cancelled(signal?:AbortSignal) {
    if(signal?.aborted){const error=new Error("Semantic Scholar request cancelled");error.name="AbortError";throw error;}
  }
  async byDOI(value:string,signal?:AbortSignal):Promise<any|undefined> {
    const doi=CitationVerifier.normalizeDOI(value);if(!doi)return;
    this.cancelled(signal);
    const result=await this.get(`https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}?fields=${FIELDS}`,signal);
    this.cancelled(signal);
    if(!result?.paperId)return;
    const returned=CitationVerifier.normalizeDOI(result.externalIds?.DOI);
    if(returned && returned!==doi)throw new Error("Semantic Scholar returned a conflicting DOI");
    return {...result,externalIds:{...result.externalIds,DOI:returned||doi}};
  }
  async byTitle(title:string,author?:string,year?:string,signal?:AbortSignal):Promise<any|undefined> {
    if(!title || title.trim().length<5)return;
    this.cancelled(signal);
    const result=await this.get(`https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(title.trim())}&limit=3&fields=${FIELDS}`,signal);
    this.cancelled(signal);
    const papers=Array.isArray(result?.data)?result.data:[];
    return selectUniqueTitle({title,author,year},papers.filter((paper:any)=>typeof paper?.paperId==="string"&&paper.paperId).map((paper:any)=>({
      value:paper,id:paper.paperId,work:{title:paper.title,year:paper.year,doi:paper.externalIds?.DOI,
        authors:(Array.isArray(paper.authors)?paper.authors:[]).map((author:any)=>author?.name).filter((name:any)=>typeof name==="string")}
    })));
  }
  toInfo(paper:any):ItemInfo {
    const doi=CitationVerifier.normalizeDOI(paper.externalIds?.DOI);
    return {title:String(paper.title||""),text:String(paper.title||""),authors:(Array.isArray(paper.authors)?paper.authors:[]).map((a:any)=>a?.name).filter((name:any)=>typeof name==="string"),
      year:paper.year?String(paper.year):undefined,type:"journalArticle",identifiers:{...(doi?{DOI:doi}:{}),paperID:paper.paperId},
      abstract:paper.abstract,primaryVenue:paper.publicationVenue?.name || paper.journal?.name,source:"semanticscholar",
      publishDate:paper.publicationDate,citationCount:paper.citationCount,url:doi?`https://doi.org/${doi}`:undefined,oaUrl:paper.openAccessPdf?.url};
  }
  async neighborhood(value:string,kind:"References"|"Citations",signal?:AbortSignal,maxRecords=500,budgetMs=25000):Promise<ReferenceResult|undefined> {
    const doi=CitationVerifier.normalizeDOI(value);if(!doi)return;
    const references:ItemBaseInfo[]=[];let offset=0,next:number|undefined,partial=false,pages=0;const seen=new Set<string>();
    const budget=new OperationBudget(signal,budgetMs);maxRecords=Math.max(1,Math.min(500,Math.floor(maxRecords)||500));
    try {
    do {
      this.cancelled(signal);
      const limit=Math.min(100,maxRecords-references.length);
      if(limit<=0 || budget.expired || ++pages>Math.ceil(maxRecords/100)){partial=true;break;}
      const response=await budget.run(child=>this.get(`https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}/${kind==="References"?"references":"citations"}?fields=paperId,title,authors,year,venue,externalIds&limit=${limit}&offset=${offset}`,child));
      this.cancelled(signal);
      if(!Array.isArray(response?.data)){if(!references.length)return undefined;partial=true;break;}
      for(const entry of response.data) {
        if(references.length>=maxRecords){partial=true;break;}
        const paper=kind==="References"?entry?.citedPaper:entry?.citingPaper;
        if(typeof paper?.title!=="string"||!paper.title.trim()){partial=true;continue;}
        const info=this.toInfo(paper);
        const aliases=[paper.paperId?`id:${paper.paperId}`:undefined,info.identifiers.DOI?`doi:${info.identifiers.DOI}`:undefined].filter(Boolean) as string[];
        if(!aliases.length)aliases.push(`title:${CitationVerifier.cleanTitle(info.title)}`);
        if(aliases.some(identity=>seen.has(identity))){partial=true;continue;}aliases.forEach(identity=>seen.add(identity));
        // Graph order is not the article's printed bibliography numbering.
        references.push({...info,publicationVenue:paper.venue,
          sources:["SemanticScholar"],confidence:info.identifiers.DOI?0.92:0.70});
      }
      const cursor=response.next;
      if(cursor!==undefined && cursor!==null && !Number.isInteger(cursor))partial=true;
      next=Number.isInteger(cursor)?Number(cursor):undefined;
      if(next!==undefined && next<=offset){partial=true;break;}
      if(next!==undefined)offset=next;
    }while(next!==undefined);
    return {references,source:"SemanticScholar",partial,status:partial?"partial":references.length?"success":"empty"};
    } finally {budget.dispose();}
  }
}
