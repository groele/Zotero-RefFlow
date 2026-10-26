import CitationVerifier from './verifier';
import {selectUniqueTitle} from './titleResolution';

export function arxivIdentity(value?:string):string|undefined {
  return value?.trim().toLowerCase().replace(/^https?:\/\/arxiv\.org\/(?:abs|pdf)\//,'').replace(/\.pdf$/,'').replace(/v\d+$/,'')||undefined;
}
export function cnkiIdentity(value?:string):string|undefined {
  try {const url=new URL(value!);const fields=new Map([...url.searchParams].map(([k,v])=>[k.toLowerCase(),v.toLowerCase()]));
    const name=fields.get('filename');return name?`${fields.get('dbcode')||fields.get('dbname')?.replace(/\d+$/,'')||''}:${name}`:undefined;
  }catch{return;}
}
/** A cache/batch key includes all supplied evidence, not just a title. */
export function workIdentity(ref:ItemBaseInfo):string {
  const doi=CitationVerifier.normalizeDOI(ref.identifiers?.DOI);if(doi)return `doi:${doi}`;
  const arxiv=arxivIdentity(ref.identifiers?.arXiv);if(arxiv)return `arxiv:${arxiv}`;
  const cnki=cnkiIdentity(ref.identifiers?.CNKI);if(cnki)return `cnki:${cnki}`;
  if(ref.identifiers?.paperID)return `s2:${ref.identifiers.paperID}`;
  return JSON.stringify([CitationVerifier.cleanTitle(ref.title||ref.text),ref.year||'',(ref.authors||[]).map(a=>a.trim().toLowerCase())]);
}

export function selectLibraryMatch(ref:ItemBaseInfo,items:Zotero.Item[]):Zotero.Item|undefined {
  const doi=CitationVerifier.normalizeDOI(ref.identifiers?.DOI);
  const candidates=items.filter(item=>{
    if(item.deleted||!item.isRegularItem())return false;
    const other=CitationVerifier.normalizeDOI(String(item.getField('DOI')));
    return !doi||!other||other===doi;
  });
  if(doi){const exact=candidates.find(item=>CitationVerifier.normalizeDOI(String(item.getField('DOI')))===doi);if(exact)return exact;}
  const arxiv=arxivIdentity(ref.identifiers?.arXiv),cnki=cnkiIdentity(ref.identifiers?.CNKI);
  if(arxiv||cnki){
    const exact=candidates.filter(item=>{
      const url=String(item.getField('url')||'');
      return arxiv?arxivIdentity(url)===arxiv:cnkiIdentity(url)===cnki;
    });
    if(exact.length===1)return exact[0];
    if(exact.length>1)return;
  }
  return selectUniqueTitle({title:ref.title||ref.text||'',author:ref.authors?.[0],year:ref.year},candidates.filter(item=>{
    const other=CitationVerifier.normalizeDOI(String(item.getField('DOI')));
    return !doi||!other||other===doi;
  }).map(item=>({value:item,id:String(item.id),work:{title:String(item.getField('title')||''),doi:CitationVerifier.normalizeDOI(String(item.getField('DOI'))),
    year:String(item.getField('date')||''),authors:item.getCreators().map((author:any)=>author.name||[author.firstName,author.lastName].filter(Boolean).join(' '))}})));
}
