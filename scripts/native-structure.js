if(!/refflow-z10-release-/.test(Zotero.DataDirectory.dir))throw new Error('Isolated profile required');
const views=Zotero.ZoteroRefFlow.views,api=views.utils.API;
const report={version:Zotero.version,at:new Date().toISOString(),scope:'native pane, cache files, SQLite and SDT; provider responses controlled',tests:[]};
const delay=ms=>Zotero.Promise.delay(ms),check=(value,message)=>{if(!value)throw new Error(message);};
const save=()=>Zotero.File.putContentsAsync(cfg.output,JSON.stringify(report,null,2));
const test=async(name,run)=>{const start=Date.now();try{report.tests.push({name,ok:true,detail:await run(),ms:Date.now()-start});}catch(error){report.tests.push({name,ok:false,error:String(error),stack:error.stack});}await save();};
const title='Quantum optical response in layered semiconductors',stamp=Date.now();
const paper=id=>({paperId:id,title,authors:[{name:'Alice Smith'}],year:2024,externalIds:{DOI:'10.1234/'+id}});
const cr=id=>({DOI:'10.1234/'+id,title:[title],author:[{family:'Smith'}],published:{'date-parts':[[2024]]}});
const oa=id=>({id:'https://openalex.org/'+id,title,doi:'10.1234/'+id,authorships:[{author:{display_name:'Alice Smith'}}],publication_year:2024});
const row=index=>({title:'Native structure evidence '+stamp+' '+index,authors:['Alice Smith'],identifiers:{DOI:'10.1234/structure-'+stamp+'-'+index},sources:['SemanticScholar']});
const make=async(name)=>{const item=new Zotero.Item('journalArticle');item.setField('title',name+' '+stamp);item.setField('DOI','10.1234/structure-'+stamp);await item.saveTx({skipSelect:true});return item;};
const panel=async(item,source='API')=>{window.Zotero_Tabs.select('zotero-pane');await window.ZoteroPane.selectItem(item.id);await delay(120);const body=window.document.querySelector('item-pane-custom-section[data-pane$="-refflow-references"] [data-type="body"]');check(body,'Missing native pane');body.setAttribute('source',source);body.setAttribute('data-refflow-type','References');return body;};
Zotero.Prefs.set('refflow.autoRefresh',false);Zotero.Prefs.set('refflow.saveAPIReferences',true);

await test('all three title providers reject conflicting identities and accept one exact title',async()=>{
  const original=api.requests.get;
  try{
    api.requests.get=async url=>url.includes('crossref.org')?{message:{items:[cr('a'),cr('b')]}}:url.includes('openalex.org')?{results:[oa('W1'),oa('W2')]}:{data:[paper('a'),paper('b')]};
    check(!await api.getTitleInfoByCrossref(title,'Smith','2024'),'Crossref picked ambiguous first result');
    check(!await api.openAlex.searchWorkByTitle(title,'Smith','2024'),'OpenAlex picked ambiguous first result');
    check(!await api.semanticScholar.byTitle(title,'Smith','2024'),'Semantic Scholar picked ambiguous first result');
    api.requests.get=async()=>({message:{items:[null,cr('unique')]}});
    check((await api.getTitleInfoByCrossref(title))?.identifiers.DOI==='10.1234/unique','Exact title without optional hints failed');
    return {providers:3,ambiguousRejected:true,titleOnlyResolved:true};
  }finally{api.requests.get=original;}
});
await test('federated DOI resolution reaches the official Semantic Scholar title endpoint',async()=>{
  const original=api.requests.get,urls=[];
  api.requests.get=async url=>{urls.push(url);return url.includes('crossref.org')?{message:{items:[]}}:url.includes('openalex.org')?{results:[]}:{data:[paper('fallback')]};};
  try{const result=await api.resolveWork(title);check(result?.doi==='10.1234/fallback','Semantic Scholar fallback missing');check(result.info.source==='semanticscholar','Fallback provenance lost');check(urls.length===3&&urls[2].startsWith('https://api.semanticscholar.org/graph/v1/paper/search?'),'Wrong title endpoint');return {providers:urls.length,officialEndpoint:true,doi:result.doi};}
  finally{api.requests.get=original;}
});
await test('an earlier title lookup exception does not block Semantic Scholar',async()=>{
  const crLookup=api.getTitleInfoByCrossref,oaLookup=api.openAlex.searchWorkByTitle,s2Lookup=api.semanticScholar.byTitle;
  try{api.getTitleInfoByCrossref=async()=>{throw new Error('Controlled 503');};api.openAlex.searchWorkByTitle=async()=>undefined;api.semanticScholar.byTitle=async()=>paper('healthy');
    check((await api.resolveWork(title))?.doi==='10.1234/healthy','Earlier exception stopped federation');return {laterProviderHealthy:true};
  }finally{api.getTitleInfoByCrossref=crLookup;api.openAlex.searchWorkByTitle=oaLookup;api.semanticScholar.byTitle=s2Lookup;}
});
await test('status-only partial online list continues into native SDT PDF fallback',async()=>{
  const item=await make('Status contract'),attachment=await Zotero.Attachments.importFromFile({file:cfg.fixtures+'\\single.pdf',parentItemID:item.id});
  const body=await panel(item),original=api.getReferenceList;
  try{api.getReferenceList=async()=>({references:[row(1),row(2)],source:'Controlled index',status:'partial'});
    await views.refreshReferences(body,false,false,false,item,{itemID:attachment.id});
    check(body.references.length===4,'Fallback did not select complete native PDF');check(body.getAttribute('data-refflow-result-source')==='PDF fallback','Wrong list selected');
    return {nativeSDT:body.references.length,completeFallback:true};
  }finally{api.getReferenceList=original;}
});
await test('malformed row is isolated and partial contract survives file cache and native pane reload',async()=>{
  const item=await make('Owned result snapshot'),body=await panel(item),original=api.getReferenceList;let calls=0;
  try{api.getReferenceList=async()=>{calls++;return {references:[row(1),null,row(2)],source:'SemanticScholar',status:'success'};};
    await views.refreshReferences(body,false,false,false,item);check(body.references.length===2,'Good rows lost');check(body.getAttribute('data-refflow-result-source').includes('(2+'),'Partial result shown as complete');
    const cached=await views.storage.getAsync(item,'References-API');check(cached.snapshot.partial&&cached.snapshot.status==='partial','Cache dropped loss flag');check(/retrieval-v\d+/.test(cached.signature),'Cache policy not updated');
    await views.storage.flush();await views.refreshReferences(body,true,false,false,item);check(calls===1,'Owned cached contract not reused');check(body.getAttribute('data-refflow-result-source').includes('(2+'),'Reload lost partial display');
    cached.references[0].identifiers.DOI='10.1234/mutated';check((await views.storage.getAsync(item,'References-API')).references[0].identifiers.DOI!=='10.1234/mutated','Cache leaked mutable state');
    return {usableRows:2,providerCalls:calls,partialSnapshot:true,fileFlushed:true};
  }finally{api.getReferenceList=original;}
});
await test('old title-selection policy cache is rejected in native pane',async()=>{
  const item=await make('Cache selection policy'),body=await panel(item),original=api.getReferenceList;let calls=0;
  try{api.getReferenceList=async()=>{calls++;return {references:[row(1)],source:'Verified title'};};await views.refreshReferences(body,false,false,false,item);
    const cache=await views.storage.getAsync(item,'References-API');cache.signature=cache.signature.replace(/retrieval-v\d+/,'retrieval-v0');cache.references=[{title:'Old ambiguous title cache',identifiers:{}}];
    await views.storage.set(item,'References-API',cache);await views.refreshReferences(body,true,false,false,item);
    check(calls===2&&body.references[0].title!=='Old ambiguous title cache','Old candidate policy accepted');return {oldCacheRejected:true,providerCalls:calls};
  }finally{api.getReferenceList=original;}
});
await test('OpenAlex duplicate rows cannot end pagination before the unique count is reached',async()=>{
  const original=api.requests.get;let page=0;
  api.requests.get=async url=>url.includes('/works/doi:')?{...oa('W1'),doi:'10.1234/parent'}:++page===1?{results:[oa('W2'),oa('W2')],meta:{count:2,next_cursor:'next'}}:{results:[oa('W3')],meta:{count:2}};
  try{const result=await api.openAlex.getNeighborhood('10.1234/parent','Citations');check(page===2&&result.references.length===2&&!result.truncated,'Duplicates prematurely ended cursor chain');return {pages:page,uniqueRecords:result.references.length};}
  finally{api.requests.get=original;}
});
await test('malformed neighborhood rows preserve native consumer evidence and partial flags',async()=>{
  const original=api.requests.get;
  api.requests.get=async url=>url.includes('semanticscholar')?{data:[null,{citedPaper:paper('valid')}]}:url.includes('/works/doi:')?{...oa('W1'),doi:'10.1234/parent'}:{results:[null,{id:'https://openalex.org/W3'},{...oa('W2'),authorships:[null]}],meta:{count:3}};
  try{const s=await api.semanticScholar.neighborhood('10.1234/parent','References'),o=await api.openAlex.getNeighborhood('10.1234/parent','Citations');check(s.references.length===1&&s.partial,'S2 row isolation failed');check(o.references.length===1&&o.truncated,'OpenAlex row isolation failed');return {semanticScholar:1,openAlex:1,lossExplicit:true};}
  finally{api.requests.get=original;}
});
report.finished=new Date().toISOString();report.passed=report.tests.filter(test=>test.ok).length;report.failed=report.tests.filter(test=>!test.ok).length;report.errors=Zotero.getErrors(true);await save();
