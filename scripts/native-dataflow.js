if(!/refflow-z10-release-/.test(Zotero.DataDirectory.dir))throw new Error('Isolated profile required');
const views=Zotero.ZoteroRefFlow.views,api=views.utils.API;
const report={version:Zotero.version,at:new Date().toISOString(),tempDir:Zotero.getTempDirectory().path,scope:'native SDT, DOM, SQLite, request cancellation; external provider responses controlled',tests:[]};
const delay=ms=>Zotero.Promise.delay(ms),check=(value,message)=>{if(!value)throw new Error(message);};
const save=()=>Zotero.File.putContentsAsync(cfg.output,JSON.stringify(report,null,2));
const test=async(name,run)=>{const start=Date.now();try{report.tests.push({name,ok:true,ms:Date.now()-start,detail:await run()});report.tests.at(-1).ms=Date.now()-start;}catch(error){report.tests.push({name,ok:false,error:String(error),stack:error.stack});}await save();};
const make=async(title,doi)=>{const item=new Zotero.Item('journalArticle');item.setField('title',title);if(doi)item.setField('DOI',doi);await item.saveTx({skipSelect:true});return item;};
Zotero.Prefs.set('refflow.autoRefresh',false);
for(const [name,count] of [['single',4],['columns',6],['author-year',3],['numbered-prose',0],['large',12]])await test('SDT extracts '+name+' without opening Reader',async()=>{
  const item=await make('Native dataflow '+name),attachment=await Zotero.Attachments.importFromFile({file:cfg.fixtures+'\\'+name+'.pdf',parentItemID:item.id});
  const original=Zotero.Reader.open;let opens=0;Zotero.Reader.open=async()=>{opens++;throw new Error('Reader open forbidden for SDT fixture');};
  try {
    const refs=await views.utils.PDF.getReferences(attachment,false,{notify:false});check(refs.length===count,'Expected '+count+', got '+refs.length);check(opens===0,'Opened reader');
    if(name==='columns')refs.forEach((ref,index)=>{check(ref.number===index+1,'Incorrect column numbering');check(ref.identifiers.DOI==='10.1234/fixture'+(index+1),'Incorrect DOI continuation: '+ref.text);});
    return {count,opens,diagnostics:views.utils.PDF.getDiagnostics(attachment)};
  }finally{Zotero.Reader.open=original;}
});
const parent=await make('Native notifier dataflow parent','10.1234/notifier-parent'),stamp=Date.now();
window.Zotero_Tabs.select('zotero-pane');await window.ZoteroPane.selectItem(parent.id);await delay(150);
const body=window.document.querySelector('item-pane-custom-section[data-pane$="-refflow-references"] [data-type="body"]');check(body,'Pane unavailable');body.setAttribute('source','API');body.setAttribute('data-refflow-type','References');
await test('item notifications update card match and retraction without refetching metadata',async()=>{
  const original=api.getReferenceList,localCheck=api.retractionChecker.checkLocal;let fetches=0;
  const title='Native notification reference '+stamp,doi='10.1234/notifier-'+stamp;
  api.getReferenceList=async()=>{fetches++;return {references:[{title,text:title,identifiers:{DOI:doi},authors:[]}],source:'Controlled'};};
  api.retractionChecker.checkLocal=(_doi,item)=>({isRetracted:Boolean(item),checked:true,reason:'Zotero local retraction warning'});
  try {
    await views.refreshReferences(body,false,false,false,parent);const row=body.querySelector('.reference-item');await delay(150);check(!row.reference._item,'Expected initial miss');
    const local=await make(title,doi);for(let i=0;i<70&&row.reference._item?.id!==local.id;i++)await delay(30);
    check(row.reference._item?.id===local.id,'Notifier did not rematch');check(row.querySelector('.reference-action').dataset.actionState==='open','Missing library action');check(row.querySelector('.reference-retracted'),'Local retraction absent');
    local.setField('DOI','10.1234/changed-'+stamp);local.setField('title','Unrelated altered local record');await local.saveTx({skipSelect:true});
    for(let i=0;i<70&&row.reference._item;i++)await delay(30);check(!row.reference._item,'Changed item retained stale match');check(!row.querySelector('.reference-retracted'),'Stale retraction retained');
    local.setField('DOI',doi);local.setField('title',title);await local.saveTx({skipSelect:true});for(let i=0;i<70&&!row.reference._item;i++)await delay(30);
    await Zotero.Items.trashTx([local.id]);for(let i=0;i<70&&row.querySelector('.reference-action').dataset.actionState!=='add';i++)await delay(30);
    check(!row.reference._item&&row.querySelector('.reference-action').dataset.actionState==='add','Deleted item retained match');check(fetches===1,'Notifier refetched remote metadata');return {fetches,addModifyDelete:true,retraction:true};
  }finally{api.getReferenceList=original;api.retractionChecker.checkLocal=localCheck;}
});
const paper=id=>({paperId:id,title:'Official provider fixture '+id,externalIds:{DOI:'10.1234/'+id},authors:[{name:'Fixture Author'}],year:2024});
await test('missing primary indexes still reach official Semantic Scholar references',async()=>{
  const original=Zotero.HTTP.request,urls=[];api.requests.clearCache();
  Zotero.HTTP.request=async(_method,url)=>{urls.push(url);return url.includes('api.semanticscholar.org/graph/v1/paper/DOI:')?{status:200,response:{data:[{citedPaper:paper('retained')}]}}:{status:404,response:{error:'Controlled missing'}};};
  try{const result=await api.getReferenceList('10.1234/native-fallback');check(result.references.length===1&&result.references[0].sources.includes('SemanticScholar'),'Fallback provider lost');check(urls.some(url=>url.includes('/references?')),'Official reference endpoint unused');return {source:result.source,count:result.references.length,official:true};}
  finally{Zotero.HTTP.request=original;api.requests.clearCache();}
});
await test('provider retraction evidence survives a clean local recheck',async()=>{
  const original=api.getReferenceList,localCheck=api.retractionChecker.checkLocal;
  api.getReferenceList=async()=>({references:[{title:'Provider retraction evidence fixture',text:'Provider retraction evidence fixture',identifiers:{DOI:'10.1234/provider-warning'},retraction:{isRetracted:true,reason:'OpenAlex authoritative fixture'}}],source:'Controlled'});
  api.retractionChecker.checkLocal=()=>({isRetracted:false,checked:true});
  try{await views.refreshReferences(body,false,false,false,parent);await delay(150);check(body.references[0].retraction?.reason==='OpenAlex authoritative fixture','Local recheck erased provider evidence');check(body.querySelector('.reference-retracted'),'Provider warning absent');return {evidencePreserved:true};}
  finally{api.getReferenceList=original;api.retractionChecker.checkLocal=localCheck;}
});
await test('official DOI, title, pagination and citation direction survive native transport',async()=>{
  const original=Zotero.HTTP.request;api.requests.clearCache();let pages=0;
  Zotero.HTTP.request=async(_method,url)=>{
    if(url.includes('/paper/search?'))return {status:200,response:{data:[{...paper('wrong'),title:'Unrelated bacteria study'}, {...paper('title'),title:'Quantum optical response in layered semiconductors'}]}};
    if(url.includes('/citations?'))return {status:200,response:{data:[{citingPaper:paper('citing'),citedPaper:paper('wrong')}]}};
    if(url.includes('/references?')){pages++;return {status:200,response:pages===1?{data:[{citedPaper:paper('one')},{citedPaper:null}],next:100}:{data:[{citedPaper:paper('two')}]}};}
    return {status:200,response:paper('origin')};
  };
  try {
    check((await api.semanticScholar.byDOI('10.1234/origin')).paperId==='origin','DOI lookup failed');
    check((await api.semanticScholar.byTitle('Quantum optical response in layered semiconductors')).paperId==='title','Title verification failed');
    const refs=await api.semanticScholar.neighborhood('10.1234/origin','References'),cites=await api.semanticScholar.neighborhood('10.1234/origin','Citations');
    check(pages===2&&refs.references.length===2&&refs.partial,'Pagination or missing-record flag failed');check(cites.references[0].identifiers.paperID==='citing','Citation direction reversed');return {pages,references:2,citations:1,partial:true};
  }finally{Zotero.HTTP.request=original;api.requests.clearCache();}
});
await test('Semantic Scholar cancellation aborts native transport and skips subsequent pages',async()=>{
  const original=Zotero.HTTP.request,controller=new window.AbortController();let calls=0,cancelled=0;api.requests.clearCache();
  Zotero.HTTP.request=async(_method,_url,options)=>{calls++;options.cancellerReceiver(()=>cancelled++);return new Promise(()=>{});};
  try{const pending=api.semanticScholar.neighborhood('10.1234/native-cancel','References',controller.signal);await Promise.resolve();controller.abort();let name;try{await pending;}catch(error){name=error.name;}
    check(name==='AbortError'&&calls===1&&cancelled===1,'Cancellation failed');return {name,calls,cancelled};}
  finally{Zotero.HTTP.request=original;api.requests.clearCache();}
});
await test('unavailable providers show a failure rather than successful empty retrieval',async()=>{
  const original=api.getReferenceList,old=JSON.stringify(body.references.map(ref=>ref.title));api.getReferenceList=async()=>({references:[],source:'Controlled unavailable',status:'unavailable'});
  try{await views.refreshReferences(body,false,false,false,parent);check(JSON.stringify(body.references.map(ref=>ref.title))===old,'Failure lost previous reference data');check(/失败|failed|保留|retained|缓存|cached/i.test(body.querySelector('#reference-num').textContent),'Unavailable result mislabeled empty');return {retained:true,label:body.querySelector('#reference-num').textContent};}
  finally{api.getReferenceList=original;}
});
await test('title-only local matching preserves punctuation in native searches',async()=>{
  const title='Quantum-optical response: layered semiconductors '+stamp,local=await make(title);
  views.utils.clearLibraryItemCache();const ref={title,text:title,identifiers:{}};
  const found=await views.utils.searchLibraryItem(ref,parent.libraryID);check(found?.id===local.id,'Punctuation-normalized search missed native title');return {matched:true};
});
await test('native Semantic Scholar key preference is masked and persists',async()=>{
  const previous=Zotero.Prefs.get('refflow.semanticScholarKey'),pref=Zotero.Utilities.Internal.openPreferences('refflow-preferences');
  try{for(let i=0;i<120&&!pref.document.getElementById('refflow-semanticscholar-key');i++)await delay(50);
    const input=pref.document.getElementById('refflow-semanticscholar-key');check(input?.type==='password','Key field missing/unmasked');input.value='isolated-test-key';input.dispatchEvent(new pref.Event('change',{bubbles:true}));await delay(100);check(Zotero.Prefs.get('refflow.semanticScholarKey')==='isolated-test-key','Preference failed');return {masked:true,persisted:true};
  }finally{Zotero.Prefs.set('refflow.semanticScholarKey',previous||'');pref.close();}
});
report.finished=new Date().toISOString();report.passed=report.tests.filter(test=>test.ok).length;report.failed=report.tests.filter(test=>!test.ok).length;report.errors=Zotero.getErrors(true);await save();
