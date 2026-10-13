if(!/refnexus-z10-release-/.test(Zotero.DataDirectory.dir))throw new Error('Isolated profile required');
const views=Zotero.ZoteroRefNexus.views,api=views.utils.API,HTTP=api.requests.constructor,Store=views.storage.constructor,OA=api.openAlex.constructor;
const report={version:Zotero.version,at:new Date().toISOString(),scope:'native XHR, atomic cache files, SQLite search; remote responses controlled',tests:[]};
const delay=ms=>Zotero.Promise.delay(ms),check=(value,message)=>{if(!value)throw new Error(message);};
const save=()=>Zotero.File.putContentsAsync(cfg.output,JSON.stringify(report,null,2));
const test=async(name,run)=>{const start=Date.now();try{report.tests.push({name,ok:true,detail:await run(),ms:Date.now()-start});}catch(error){report.tests.push({name,ok:false,error:String(error),stack:error.stack});}await save();};
const base='http://127.0.0.1:18796',stamp=Date.now();
const paper=id=>({id:'https://openalex.org/'+id,title:'Controlled publication '+id,doi:'10.1234/'+id,authorships:[],publication_year:2024});

await test('provider deadline includes DOI lookup and physically cancels real native XHR',async()=>{
  const original=Zotero.HTTP.request,client=new HTTP(),provider=new OA(client);let cancelled=0;
  Zotero.HTTP.request=(method,url,options)=>{
    const receiver=options.cancellerReceiver;
    return original.call(Zotero.HTTP,method,base+'/slow?deadline='+stamp,{...options,cancellerReceiver:fn=>receiver(()=>{cancelled++;fn();})});
  };
  try{const start=Date.now();let error;try{await provider.getNeighborhood('10.1234/origin','Citations',undefined,120);}catch(e){error=String(e);}
    await delay(20);check(error?.includes('lookup failed'),'Lookup deadline did not settle');check(cancelled===1,'Native XHR not cancelled');check(client.cacheUsage.entries===0,'Cancelled response cached');check(client.inFlight.size===0&&client.active===0,'Scheduler leaked');return {elapsed:Date.now()-start,cancelled,cache:client.cacheUsage};
  }finally{client.dispose();Zotero.HTTP.request=original;}
});
await test('later page budget expiry preserves partial metadata',async()=>{
  const original=Zotero.HTTP.request,client=new HTTP(),provider=new OA(client);let pages=0;
  Zotero.HTTP.request=(method,url,options)=>{
    if(url.includes('/works/doi:'))return Promise.resolve({status:200,response:{...paper('W1'),doi:'10.1234/origin'}});
    if(++pages===1)return Promise.resolve({status:200,response:{results:[paper('W2')],meta:{count:2,next_cursor:'next'}}});
    return original.call(Zotero.HTTP,method,base+'/slow?partial='+stamp,options);
  };
  try{const result=await provider.getNeighborhood('10.1234/origin','Citations',undefined,120);check(result.references.length===1&&result.truncated,'Budget lost partial results');check(pages===2,'Unexpected pagination');return {pages,count:result.references.length,truncated:result.truncated};}
  finally{client.dispose();Zotero.HTTP.request=original;}
});
await test('one provider deadline leaves another shared XHR subscriber healthy',async()=>{
  const original=Zotero.HTTP.request,client=new HTTP(),provider=new OA(client);let cancelled=0,network=0;
  Zotero.HTTP.request=(method,url,options)=>{
    if(url.includes('/works/doi:'))return Promise.resolve({status:200,response:{...paper('W1'),doi:'10.1234/origin'}});
    network++;const receiver=options.cancellerReceiver;
    return original.call(Zotero.HTTP,method,base+'/parallel?shared='+stamp,{...options,cancellerReceiver:fn=>receiver(()=>{cancelled++;fn();})})
      .then(response=>({status:response.status,response:{results:[paper('W2')],meta:{count:1}}}));
  };
  try{const [short,long]=await Promise.allSettled([provider.getNeighborhood('10.1234/origin','Citations',undefined,40),provider.getNeighborhood('10.1234/origin','Citations',undefined,2000)]);
    check(short.status==='rejected','Short operation did not expire');check(long.status==='fulfilled'&&long.value.references.length===1,'Other subscriber lost response');check(network===1&&cancelled===0,'Shared transport was broken');return {network,cancelled,deduplicated:client.metrics.deduplicated};}
  finally{client.dispose();Zotero.HTTP.request=original;}
});
await test('hydration validates identities and creates only four concurrent producers',async()=>{
  const original=Zotero.HTTP.request,client=new HTTP(),provider=new OA(client);let active=0,peak=0,calls=0;
  Zotero.HTTP.request=async(_method,url)=>{
    active++;peak=Math.max(peak,active);calls++;await delay(10);active--;
    const ids=new URL(url).searchParams.get('filter').replace(/^openalex:/,'').split('|');
    return {status:200,response:{results:[...ids.reverse().map(paper),paper('W99999')]}};
  };
  try{const ids=Array.from({length:1000},(_,i)=>'https://openalex.org/W'+(i+1));const summaries=await provider.hydrateBatch(ids);
    check(calls===10&&peak<=4,'Unbounded hydration');check(summaries.length===1000&&summaries[0].openalexId===ids[0]&&summaries.at(-1).openalexId===ids.at(-1),'Hydration identity/order failure');return {calls,peak,count:summaries.length};}
  finally{client.dispose();Zotero.HTTP.request=original;}
});
await test('native cache obeys UTF8 byte limit, owns data and reloads atomic disk state',async()=>{
  const name='native-pipeline-cache-'+stamp,store=new Store(name,{maxBytes:500,entryMaxBytes:250}),item={key:'OWNED',libraryID:1};
  let reloaded;
  try {
    await store.set(item,'data',{nested:['中文']});const copy=store.get(item,'data');copy.nested.push('mutation');check(store.get(item,'data').nested.length===1,'Read mutated cache');
    for(let i=0;i<10;i++)await store.set({key:'K'+i,libraryID:1},'data','a'.repeat(100));
    check(store.cacheUsage.bytes<=500&&store.metrics.evictions>0,'Byte budget exceeded');
    await store.set(item,'data','a'.repeat(500));check(store.get(item,'data')===undefined,'Oversized cache entry retained');
    await store.set({key:'UNSCOPED'},'data',1);check(store.get({key:'UNSCOPED'},'data')===undefined,'Unscoped cache guessed personal library');
    await store.dispose();const file=Zotero.File.pathToFile(store.filename);check(file.exists()&&file.fileSize<=500,'Disk size budget violated');check(!Zotero.File.pathToFile(store.filename+'.tmp').exists(),'Atomic temporary file remained');
    reloaded=new Store(name,{maxBytes:500,entryMaxBytes:250});await reloaded.lock.promise;check(reloaded.get({key:'K9',libraryID:1},'data')==='a'.repeat(100),'Reload lost final entry');return {bytes:file.fileSize,usage:store.cacheUsage,metrics:store.metrics,reloaded:true};
  } finally {await store.dispose();await reloaded?.dispose();}
});
await test('atomic write failure can retry the newest state',async()=>{
  const original=Zotero.File.putContentsAsync,store=new Store('native-pipeline-retry-'+stamp);await store.lock.promise;
  const item={key:'RETRY',libraryID:1};let failures=0;
  Zotero.File.putContentsAsync=async(path,data)=>{if(path===store.filename&&failures++===0)throw new Error('Controlled write failure');return original.call(Zotero.File,path,data);};
  try{await store.set(item,'data',1);let failed=false;try{await store.flush();}catch{failed=true;}check(failed,'Fault not exercised');await store.set(item,'data',2);await store.flush();const data=JSON.parse(await Zotero.File.getContentsAsync(store.filename));check(data['1:RETRY'].data===2,'Retry wrote old state');return {retried:true,metrics:store.metrics};}
  finally{Zotero.File.putContentsAsync=original;await store.dispose();}
});
await test('authentication POST stays fresh and out of the cache',async()=>{
  const original=Zotero.HTTP.request,client=new HTTP();let calls=0;
  Zotero.HTTP.request=async()=>({status:200,response:{Content:'fixture-token-'+(++calls)}});
  try{const body={Username:'fixture',Password:'fixture'};const first=await client.post('https://apix.cnki.net/controlled-auth',body,'json',{},undefined,{cache:false});const second=await client.post('https://apix.cnki.net/controlled-auth',body,'json',{},undefined,{cache:false});check(first.Content!==second.Content&&calls===2,'Authentication reused old token');check(client.cacheUsage.entries===0,'Credential response cached');return {fresh:true,cache:client.cacheUsage};}
  finally{client.dispose();Zotero.HTTP.request=original;}
});
await test('two thousand exact DOI enrichments preserve order with indexed matching',async()=>{
  const get=api.requests.get,lookup=api.openAlex.getWorkByDOI,hydrate=api.openAlex.hydrateBatch;
  const references=Array.from({length:2000},(_,i)=>({DOI:'10.1234/perf-'+i,'article-title':'Reference '+i}));
  api.requests.get=async()=>({message:{DOI:'10.1234/origin',title:['Origin'],'reference-count':2000,reference:references}});
  api.openAlex.getWorkByDOI=async()=>({work:{},referencedWorks:references.map((_,i)=>'W'+(i+1))});
  api.openAlex.hydrateBatch=async()=>references.map((ref,i)=>({doi:ref.DOI,title:'Reference '+i,openalexId:'W'+(i+1),authors:[],isOA:true,oaUrl:'https://example.org/'+i}));
  try{const start=Date.now();const info=await api.getDOIInfoByCrossref('10.1234/origin');check(info.references.length===2000,'Enrichment lost records');check(info.references.every((ref,i)=>ref.identifiers.DOI===references[i].DOI&&ref.oaUrl==='https://example.org/'+i),'Enrichment altered order or identity');return {count:2000,ms:Date.now()-start,orderPreserved:true};}
  finally{api.requests.get=get;api.openAlex.getWorkByDOI=lookup;api.openAlex.hydrateBatch=hydrate;}
});
await test('Zotero 10 resultLevel search excludes child matches and finds the regular item',async()=>{
  const title='Native result level pipeline fixture '+stamp,item=new Zotero.Item('journalArticle');item.setField('title',title);await item.saveTx({skipSelect:true});
  const note=new Zotero.Item('note');note.parentID=item.id;note.setNote(title);await note.saveTx({skipSelect:true});
  const original=Zotero.Search.prototype.addCondition;let levelSeen=false;
  Zotero.Search.prototype.addCondition=function(...args){if(args[0]==='resultLevel'&&args[1]==='item')levelSeen=true;return original.apply(this,args);};
  try{views.utils.clearLibraryItemCache();const found=await views.utils.searchLibraryItem({title,text:title,identifiers:{}},item.libraryID);check(found?.id===item.id&&levelSeen,'Native resultLevel path failed');return {matched:true,resultLevel:true};}
  finally{Zotero.Search.prototype.addCondition=original;}
});
await test('whole-pane deadline releases busy state, preserves cards and blocks late results',async()=>{
  const parent=new Zotero.Item('journalArticle');parent.setField('title','Whole pipeline deadline '+stamp);parent.setField('DOI','10.1234/pane-deadline');await parent.saveTx({skipSelect:true});
  Zotero.Prefs.set('refnexus.autoRefresh',false);window.Zotero_Tabs.select('zotero-pane');await window.ZoteroPane.selectItem(parent.id);await delay(100);
  const body=window.document.querySelector('item-pane-custom-section[data-pane$="-refnexus-references"] [data-type="body"]');check(body,'Pane missing');body.setAttribute('source','API');body.setAttribute('data-refnexus-type','References');
  const get=api.getReferenceList,previous=views.referenceTasks.timeoutMs;let release;
  api.getReferenceList=async()=>({references:[{title:'Kept before deadline',identifiers:{}}],source:'Controlled'});
  try{await views.refreshReferences(body,false,false,false,parent);const old=body.references;api.getReferenceList=async()=>new Promise(resolve=>{release=resolve;});views.referenceTasks.timeoutMs=80;
    const start=Date.now();await views.refreshReferences(body,false,false,false,parent);
    check(Date.now()-start<1000,'Whole refresh stayed pending');check(!body.hasAttribute('aria-busy')&&body.querySelector('#refnexus-cancel').hidden,'Timeout left busy state');check(body.references===old,'Timeout discarded cards');check(/超时|timed out|timeout/i.test(body.querySelector('#reference-num').textContent),'No timeout status');
    release({references:[{title:'LATE DEADLINE DATA',identifiers:{}}],source:'Late'});await delay(30);check(body.references===old,'Late timeout response committed');return {released:true,kept:true,lateCommitRejected:true};
  }finally{api.getReferenceList=get;views.referenceTasks.timeoutMs=previous;}
});
await test('native import rejects conflicting translator identity and stores normalized DOI',async()=>{
  const original=Zotero.Translate.Search,parent=new Zotero.Item('journalArticle');parent.setField('title','Translator identity parent '+stamp);await parent.saveTx({skipSelect:true});
  Zotero.Translate.Search=class{setIdentifier(){}async getTranslators(){return ['controlled'];}setTranslator(){}async translate(){return [{itemType:'journalArticle',DOI:'10.1234/wrong',title:'WRONG TRANSLATOR PUBLICATION'}];}};
  try{const ref={title:'Expected reference '+stamp,text:'Expected reference '+stamp,identifiers:{DOI:'https://doi.org/10.1234/EXPECTED-'+stamp},authors:[],type:'note'};
    const result=await views.importReferences(parent,[ref],{downloadOA:false,createSubCollection:false,createManifestNote:false});
    check(result.importedCount===1&&ref._item,'Import failed');check(ref._item.getField('title')===ref.title,'Conflicting translator metadata leaked');check(ref._item.getField('DOI')==='10.1234/expected-'+stamp,'DOI was not normalized');check(ref._item.isRegularItem(),'Created an attachment/note instead of bibliographic item');
    await views.rollbackReferences(parent,result.batchId);check(ref._item.deleted,'Rollback failed');return {identityPreserved:true,normalized:true,regularItem:true,rollback:true};
  }finally{Zotero.Translate.Search=original;}
});
await test('metadata edits during retrieval reject the old result and release busy state',async()=>{
  const parent=new Zotero.Item('journalArticle');parent.setField('title','Metadata snapshot '+stamp);parent.setField('DOI','10.1234/meta-before');await parent.saveTx({skipSelect:true});
  window.Zotero_Tabs.select('zotero-pane');await window.ZoteroPane.selectItem(parent.id);await delay(100);const body=window.document.querySelector('item-pane-custom-section[data-pane$="-refnexus-references"] [data-type="body"]');body.setAttribute('source','API');body.setAttribute('data-refnexus-type','References');
  const get=api.getReferenceList;let release;
  api.getReferenceList=async()=>new Promise(resolve=>{release=resolve;});
  try{const pending=views.refreshReferences(body,false,false,false,parent);for(let i=0;i<50&&!release;i++)await delay(10);check(release,'Request not started');parent.setField('DOI','10.1234/meta-after');await parent.saveTx({skipSelect:true});release({references:[{title:'STALE METADATA DATA',identifiers:{}}],source:'Old metadata'});await pending;
    check(!body.references?.length,'Old metadata response committed');check(!body.hasAttribute('aria-busy'),'Context change left busy state');check(/改变|changed|刷新|refresh/i.test(body.querySelector('#reference-num').textContent),'Context change not reported');return {lateResultRejected:true,busyReleased:true};}
  finally{api.getReferenceList=get;}
});
await test('same-parent PDF requests remain distinct and only the newest document commits',async()=>{
  const parent=new Zotero.Item('journalArticle');parent.setField('title','PDF context snapshot '+stamp);await parent.saveTx({skipSelect:true});
  const a=await Zotero.Attachments.importFromFile({file:cfg.fixtures+'\\single.pdf',parentItemID:parent.id}),b=await Zotero.Attachments.importFromFile({file:cfg.fixtures+'\\columns.pdf',parentItemID:parent.id});
  window.Zotero_Tabs.select('zotero-pane');await window.ZoteroPane.selectItem(parent.id);await delay(100);const body=window.document.querySelector('item-pane-custom-section[data-pane$="-refnexus-references"] [data-type="body"]');body.setAttribute('source','PDF');body.setAttribute('data-refnexus-type','References');
  const get=views.utils.PDF.getReferences;let release,calls=0;
  views.utils.PDF.getReferences=async attachment=>{calls++;return attachment.id===a.id?new Promise(resolve=>{release=resolve;}):[{title:'Current PDF B',identifiers:{}}];};
  try{const first=views.refreshReferences(body,false,false,false,parent,{itemID:a.id});for(let i=0;i<50&&!release;i++)await delay(10);check(release,'First PDF not started');await views.refreshReferences(body,false,false,false,parent,{itemID:b.id});await first;check(calls===2,'Different PDFs coalesced');check(body.references[0].title==='Current PDF B','Wrong PDF committed');release([{title:'Stale PDF A',identifiers:{}}]);await delay(30);check(body.references[0].title==='Current PDF B','Late PDF replaced current result');return {calls,newestDocument:true,lateCommitRejected:true,readerSelection:'controlled public itemID overrides; native attachment files'};}
  finally{views.utils.PDF.getReferences=get;}
});
await test('CNKI title identity and DOM parsing work without a DOCTYPE and do not invent counts',async()=>{
  const get=api.requests.get,url=api.getCNKIURL,title='层状半导体中的谷极化与光学响应研究';api.requests.clearCache();
  api.getCNKIURL=async()=> 'https://kns.cnki.net/kcms/detail/detail.aspx?FileName=controlled&DbName=CJFDTOTAL&DbCode=CJFD';
  api.requests.get=async()=>'<html><body><div class="brief"><h1>完全不同的主题检索结果</h1></div></body></html>';
  try{check(await api.getTitleInfoByCNKI(title)===undefined,'Unrelated first subject hit was trusted');api.requests.get=async()=>'<html><body><div class="brief"><h1>'+title+'</h1></div></body></html>';
    const info=await api.getTitleInfoByCNKI(title);check(info?.title===title,'No-DOCTYPE detail page failed');check(!info.tags.some(tag=>typeof tag==='object'&&tag.tip==='知网下载量'),'Unknown download count became zero');return {mismatchRejected:true,noDoctype:true,unknownCountPreserved:true,provider:'controlled CNKI detail HTML; no account/live-service claim'};}
  finally{api.requests.get=get;api.getCNKIURL=url;api.requests.clearCache();}
});
await test('legacy PDF algorithm cache is invalidated before native extraction',async()=>{
  const parent=new Zotero.Item('journalArticle');parent.setField('title','Cache algorithm revision '+stamp);await parent.saveTx({skipSelect:true});
  const attachment=await Zotero.Attachments.importFromFile({file:cfg.fixtures+'\\single.pdf',parentItemID:parent.id});
  window.Zotero_Tabs.select('zotero-pane');await window.ZoteroPane.selectItem(parent.id);await delay(100);const body=window.document.querySelector('item-pane-custom-section[data-pane$="-refnexus-references"] [data-type="body"]');body.setAttribute('source','PDF');body.setAttribute('data-refnexus-type','References');
  const current=await views.pdfCacheSignature(parent,{itemID:attachment.id});check(current.startsWith('pdf-sdt-v2:'),'Extraction policy version missing');
  await views.storage.set(parent,'References-PDF',{schema:3,signature:current.replace('pdf-sdt-v2:','pdf-sdt-v1:'),savedAt:Date.now(),references:[{title:'OLD ALGORITHM DATA',identifiers:{}}],snapshot:{source:'PDF',partial:false}});
  await views.refreshReferences(body,true,false,false,parent,{itemID:attachment.id});check(body.references.length===4&&!body.references.some(ref=>ref.title==='OLD ALGORITHM DATA'),'Old extraction policy cache reused');return {oldCacheRejected:true,nativeReferences:4};
});
report.finished=new Date().toISOString();report.passed=report.tests.filter(test=>test.ok).length;report.failed=report.tests.filter(test=>!test.ok).length;report.errors=Zotero.getErrors(true);await save();
