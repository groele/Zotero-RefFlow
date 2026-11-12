import CitationVerifier from './verifier';
import {selectUniqueTitle} from './titleResolution';

export function getItemDOI(item?: Zotero.Item): string|undefined {
  if(!item)return undefined;
  const direct=CitationVerifier.normalizeDOI(String(item.getField('DOI')||''));
  if(direct)return direct;
  const extra=String(item.getField('extra')||'');
  const match=extra.match(/^DOI:\s*(.+)$/im);
  return match?CitationVerifier.normalizeDOI(match[1]):undefined;
}

export function applyItemDOI(item: Zotero.Item, rawDOI?: string): boolean {
  const doi=CitationVerifier.normalizeDOI(rawDOI);
  if(!item||!doi)return false;
  const native=Zotero as any;
  const fieldID=native.ItemFields?.getID?.('DOI');
  if(fieldID&&native.ItemFields?.isValidForType?.(fieldID,item.itemTypeID)){
    if(CitationVerifier.normalizeDOI(String(item.getField('DOI')||''))!==doi){
      item.setField('DOI',doi);
      return true;
    }
    return false;
  }
  const extra=String(item.getField('extra')||'');
  const eol=extra.includes('\r\n')?'\r\n':'\n';
  const lines=extra?extra.split(/\r?\n/):[];
  const idx=lines.findIndex(line=>/^DOI:\s*/i.test(line));
  if(idx>=0){
    const existing=CitationVerifier.normalizeDOI(lines[idx].replace(/^DOI:\s*/i,''));
    if(existing)return false;
    lines[idx]=`DOI: ${doi}`;
  }else{
    lines.push(`DOI: ${doi}`);
  }
  item.setField('extra',lines.join(eol));
  return true;
}

export function isRegularLibraryItem(item: any): boolean {
  if(!item||item.deleted)return false;
  if(typeof item.isRegularItem==='function')return Boolean(item.isRegularItem());
  return !item.isAttachment?.()&&!item.isNote?.();
}

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
  const hasEvidence=Boolean(ref.authors?.some(a=>a&&a.trim())||String(ref.year??'').match(/\b(19\d\d|20\d\d)\b/));
  const candidates=items.filter(item=>{
    if(!isRegularLibraryItem(item))return false;
    const other=getItemDOI(item);
    if(doi&&other&&other!==doi)return false;
    if(Boolean(doi)!==Boolean(other)&&!hasEvidence)return false;
    return true;
  });
  if(doi){const exact=candidates.find(item=>getItemDOI(item)===doi);if(exact)return exact;}
  const arxiv=arxivIdentity(ref.identifiers?.arXiv),cnki=cnkiIdentity(ref.identifiers?.CNKI);
  if(arxiv||cnki){
    const exact=candidates.filter(item=>{
      const url=String(item.getField('url')||'');
      return arxiv?arxivIdentity(url)===arxiv:cnkiIdentity(url)===cnki;
    });
    if(exact.length===1)return exact[0];
    if(exact.length>1)return;
  }
  return selectUniqueTitle({title:ref.title||ref.text||'',author:ref.authors?.[0],year:ref.year},candidates.map(item=>({
    value:item,
    id:String(item.id),
    work:{
      title:String(item.getField('title')||''),
      doi:getItemDOI(item),
      year:String(item.getField('date')||''),
      authors:(typeof item.getCreators==='function'?item.getCreators():[]).map((author:any)=>author.name||[author.firstName,author.lastName].filter(Boolean).join(' '))
    }
  })));
}
