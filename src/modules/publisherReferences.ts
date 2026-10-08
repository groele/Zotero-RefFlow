import Requests from "./requests";
import CitationVerifier from "./verifier";

export interface PublisherProfile { name: string; hosts: string[]; selectors: string; }
/** Select only bibliography containers, never links in recommendations or the article body. */
export const PUBLISHER_PROFILES: PublisherProfile[] = [
  {name:"Nature / Springer",hosts:["nature.com","link.springer.com","link.springernature.com","biomedcentral.com"],selectors:".c-article-references__item, .c-article-references li, .Bibliography .Citation, .bibliography .citation"},
  {name:"Elsevier",hosts:["sciencedirect.com","cell.com"],selectors:".references .bib-reference, .references .reference, .ref-list .ref, .references li"},
  {name:"Wiley",hosts:["onlinelibrary.wiley.com"],selectors:".references .citation, .references li, .bibliography li"},
  {name:"ACS",hosts:["pubs.acs.org"],selectors:".NLM_ref, .references .citation, .references li"},
  {name:"RSC",hosts:["pubs.rsc.org"],selectors:".reference, .references li, .ref-list li"},
  {name:"APS",hosts:["journals.aps.org"],selectors:".bibitem, .references li, .refs li"},
  {name:"AIP / IOP",hosts:["pubs.aip.org","iopscience.iop.org"],selectors:".ref-list .ref, .references .ref, .ref-list li, .references li"},
  {name:"Taylor & Francis",hosts:["tandfonline.com"],selectors:".references .citation, .references li, .ref-list li"},
  {name:"PLOS",hosts:["journals.plos.org"],selectors:".references > ol > li, .references li, #references li"},
  {name:"MDPI",hosts:["mdpi.com"],selectors:".html-refs li, .html-refs .html-ref, #html-references_list li"},
  {name:"Frontiers",hosts:["frontiersin.org"],selectors:".references .Reference, .references .reference, .References .Reference, .ref-list .ref, #references p"},
  {name:"eLife",hosts:["elifesciences.org"],selectors:".reference-list .reference, .references .reference, .reference-list li"},
  {name:"Science / PNAS",hosts:["science.org","pnas.org"],selectors:".references .citation, .references li, .ref-list .ref, .ref-list li"}
];

export function publisherForURL(value: string): PublisherProfile | undefined {
  try {
    const url=new URL(value);
    if(url.protocol!=="https:" || url.username || url.password)return;
    return PUBLISHER_PROFILES.find(profile=>profile.hosts.some(host=>url.hostname===host||url.hostname.endsWith("."+host)));
  } catch {return;}
}

const clean=(value:any)=>String(value?.textContent||value||"").replace(/\s+/g," ").trim();
const doi=(value?:string)=>CitationVerifier.normalizeDOI(value);
const MAX_REFERENCES=2000;

function matchingArticle(document:Document,expectedDOI:string,title?:string):boolean {
  const values=[...document.querySelectorAll('meta[name="citation_doi"], meta[name="dc.Identifier"], meta[name="DC.Identifier"], meta[property="prism:doi"], meta[name="prism.doi"]')].map(element=>doi(element.getAttribute("content")||""));
  const declared=values.filter(Boolean);
  if(declared.length&&doi(expectedDOI))return declared.includes(doi(expectedDOI));
  const candidate=clean(document.querySelector('meta[name="citation_title"]')?.getAttribute("content")||document.querySelector("h1"));
  const target=CitationVerifier.cleanTitle(title),actual=CitationVerifier.cleanTitle(candidate);
  return Boolean(target.length>=20 && actual.length>=20 && CitationVerifier.tokenJaccard(target,actual)>=0.9);
}

export function parsePublisherHTML(document:Document,url:string,expectedDOI:string,title?:string):ItemBaseInfo[] {
  const profile=publisherForURL(url);
  if(!profile || !matchingArticle(document,expectedDOI,title))return [];
  const nodes=[...document.querySelectorAll(profile.selectors)];
  const seen=new Set<string>();
  return nodes.filter(node=>!nodes.some(other=>other!==node&&other.contains(node))).slice(0,MAX_REFERENCES).flatMap((node,index)=>{
    const copy=node.cloneNode(true) as Element;
    copy.querySelectorAll('script, style, button, .c-article-references__links, .reference-links, .ref-links, .ref-actions').forEach(element=>element.remove());
    const text=clean(copy).replace(/^\s*(?:\[\d+\]|\d+[.)]?)\s*/,"");
    if(text.length<15 || seen.has(text))return [];
    seen.add(text);
    const links=[...node.querySelectorAll("a[href]")].map(link=>link.getAttribute("href")||"");
    const identifier=links.map(link=>/^https?:\/\/(?:dx\.)?doi\.org\//i.test(link)?doi(link):undefined).find(Boolean) || doi(text.match(/(?:doi\s*:?\s*|https?:\/\/(?:dx\.)?doi\.org\/)(10\.\d{4,9}\/[^\s<>]+)/i)?.[1]);
    const number=Number(node.querySelector('.ref-label, .label')?.textContent?.match(/\d+/)?.[0])||Number(node.getAttribute("value"))||Number(node.id.match(/(?:ref|CR)(\d+)$/i)?.[1])||index+1;
    return [{text,title:clean(node.querySelector('.article-title, .ref-title, [itemprop="name"]'))||undefined,authors:[],identifiers:identifier?{DOI:identifier}:{},number,year:text.match(/\b(?:18|19|20)\d{2}\b/)?.[0],url:identifier?`https://doi.org/${identifier}`:undefined,sources:[profile.name+" HTML"]} as ItemBaseInfo];
  });
}

/** JATS is shared by many publishers; validate the parent DOI before accepting its back matter. */
export function parseJATS(document:Document,expectedDOI:string):ItemBaseInfo[] {
  if(document.querySelector("parsererror, error"))return [];
  const articles=[...document.getElementsByTagName("article")];
  const article=articles.find(article=>[...article.querySelectorAll('front article-id[pub-id-type="doi"]')].some(id=>doi(clean(id))===doi(expectedDOI)));
  if(!article)return [];
  const seen=new Set<string>();
  return [...article.querySelectorAll("back ref-list ref")].slice(0,MAX_REFERENCES).flatMap((ref,index)=>{
    const citation=ref.querySelector("mixed-citation, element-citation, nlm-citation")||ref;
    const identifier=doi(clean(citation.querySelector('pub-id[pub-id-type="doi"]'))) || [...citation.querySelectorAll("ext-link")].map(link=>doi(link.getAttribute("xlink:href")||link.getAttribute("href")||clean(link))).find(Boolean);
    const title=clean(citation.querySelector("article-title, chapter-title"));
    const authors=[...citation.querySelectorAll("person-group name, person-group string-name")].map(name=>[clean(name.querySelector("given-names")),clean(name.querySelector("surname"))].filter(Boolean).join(" ")||clean(name));
    const year=clean(citation.querySelector("year")),venue=clean(citation.querySelector("source"));
    // Element-only citations omit punctuation, so construct a readable fallback.
    const text=citation.localName==="element-citation"?[authors.join(", "),title,venue,year,identifier].filter(Boolean).join(". "):clean(citation);
    const key=`${ref.getAttribute("id")||index}:${text}`;
    if(text.length<12 || seen.has(key))return [];
    seen.add(key);
    return [{text,title:title||undefined,authors,year:year||undefined,publicationVenue:venue||undefined,identifiers:identifier?{DOI:identifier}:{},number:Number(clean(ref.querySelector("label")).match(/\d+/)?.[0])||index+1,url:identifier?`https://doi.org/${identifier}`:undefined,sources:["PMC JATS"]} as ItemBaseInfo];
  });
}

export default class PublisherReferences {
  // One worker and a bounded queue also serialize PMC requests across rapid item switches.
  private requests=new Requests({timeoutMs:8000,budgetMs:10000,maxConcurrent:1,maxQueued:8});
  private pmcTail:Promise<any>=Promise.resolve();
  private pmcLast=0;
  private pending=0;
  private disposed=false;
  private misses=new Map<string,number>();
  private async request(url:string,type="json",headers:Record<string,string>={}) {
    // Persist parsed references in the pane cache, not hundreds of full HTML/XML bodies.
    try{return await this.requests.get(url,type as any,headers);}finally{this.requests.clearCache();}
  }
  clearCache(){this.requests.clearCache();this.misses.clear();}
  dispose(){this.disposed=true;this.requests.dispose();this.misses.clear();}
  parseHTML(html:string,url:string,expectedDOI:string,title?:string){
    if(html.length>8*1024*1024)return [];
    return parsePublisherHTML(ztoolkit.getDOMParser().parseFromString(html,"text/html"),url,expectedDOI,title);
  }
  parseXML(xml:string,expectedDOI:string){
    if(xml.length>12*1024*1024)return [];
    return parseJATS(ztoolkit.getDOMParser().parseFromString(xml,"application/xml"),expectedDOI);
  }
  async getReferences(expectedDOI:string,url?:string,title?:string,signal?:AbortSignal):Promise<ItemBaseInfo[]> {
    const key=doi(expectedDOI);
    if(!key||signal?.aborted||this.disposed||this.pending>=8)return [];
    const cacheKey=key+"|"+(url||"");
    if((this.misses.get(cacheKey)||0)>Date.now())return [];
    if(url && publisherForURL(url)) {
      const html=await this.request(url,"text",{Accept:"text/html"});
      if(signal?.aborted||this.disposed)return [];
      if(typeof html==="string") {const references=this.parseHTML(html,url,key,title);if(references.length)return references;}
    }
    const run=async()=>{
      if(signal?.aborted||this.disposed)return [];
      await Zotero.Promise.delay(Math.max(0,350-(Date.now()-this.pmcLast)));
      this.pmcLast=Date.now();
      const data=await this.request(`https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/?ids=${encodeURIComponent(key)}&idtype=doi&format=json&tool=RefNexus`);
      if(signal?.aborted)return [];
      const record=data?.records?.find((record:any)=>doi(record.doi)===key&&/^PMC\d+$/.test(record.pmcid));
      if(!record)return [];
      await Zotero.Promise.delay(Math.max(0,350-(Date.now()-this.pmcLast)));this.pmcLast=Date.now();
      const xml=await this.request(`https://pmc.ncbi.nlm.nih.gov/api/oai/v1/mh/?verb=GetRecord&identifier=oai:pubmedcentral.nih.gov:${record.pmcid.slice(3)}&metadataPrefix=pmc`,"text",{Accept:"application/xml","Accept-Encoding":"gzip, deflate"});
      return !signal?.aborted&&typeof xml==="string"?this.parseXML(xml,key):[];
    };
    if(this.pending>=8||signal?.aborted||this.disposed)return [];
    this.pending++;
    const job=this.pmcTail.then(run,run).finally(()=>{this.pending--;});this.pmcTail=job.catch(()=>{});
    const references=await job;
    if(!references.length && !signal?.aborted&&!this.disposed){if(this.misses.size>=100)this.misses.delete(this.misses.keys().next().value);this.misses.set(cacheKey,Date.now()+5*60*1000);}
    return references;
  }
}
