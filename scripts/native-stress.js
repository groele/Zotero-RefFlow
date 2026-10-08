// Real Zotero DOM, PDF.js, XHR and SQLite; controlled faults are explicitly identified.
if (!/refnexus-z10-/.test(Zotero.DataDirectory.dir)) throw new Error('Isolated test library required');
const views=Zotero.ZoteroRefNexus?.views;
if(!views?.referenceTasks)throw new Error('Updated plugin unavailable');
const report={version:Zotero.version,at:new Date().toISOString(),tests:[],metrics:{},scope:'isolated native Zotero; loopback HTTP faults; metadata translator fault injection'};
const check=(ok,message)=>{if(!ok)throw new Error(message)};
const delay=ms=>Zotero.Promise.delay(ms);
const test=async(name,fn)=>{
  const start=Date.now();
  try{report.tests.push({name,ok:true,ms:Date.now()-start,detail:await fn()});report.tests.at(-1).ms=Date.now()-start;}
  catch(error){report.tests.push({name,ok:false,ms:Date.now()-start,error:String(error),stack:error?.stack});}
  await Zotero.File.putContentsAsync(cfg.output,JSON.stringify(report,null,2));
};
const make=async(title,doi)=>{const item=new Zotero.Item('journalArticle');item.setField('title',title);if(doi)item.setField('DOI',doi);await item.saveTx();return item;};
const stamp=Date.now();
const parent=await make(`RefNexus stress parent ${stamp}`,'10.1234/stress-parent-'+stamp);
const other=await make(`RefNexus alternative item ${stamp}`,'10.1234/stress-other-'+stamp);
const select=async(item)=>{window.Zotero_Tabs.select('zotero-pane');await window.ZoteroPane.selectItem(item.id);await delay(80);const body=window.document.querySelector('item-pane-custom-section[data-pane$="-refnexus-references"] [data-type="body"]');check(body,'Native pane missing');return body;};
const attachment=await Zotero.Attachments.importFromFile({file:cfg.fixtures+'\\columns.pdf',parentItemID:parent.id});
const reader=await Zotero.Reader.open(attachment.id);await delay(1000);
const originalPerform=views.performReferences;
views.performReferences=async(...args)=>{try{return await originalPerform.apply(views,args);}catch(error){(report.referenceErrors??=[]).push({error:String(error),stack:error?.stack});throw error;}};

await test('native fetch button and force refresh render six PDF rows',async()=>{
  const body=await select(parent);body.setAttribute('source','PDF');
  body.querySelector('#refresh-button').click();
  for(let i=0;i<100 && !(body.references?.length);i++)await delay(100);
  check(body.references?.length===6,'Fetch button did not produce six references');
  check(body.querySelectorAll('.reference-text').length===6,'Native reference rows missing');
  check(!body.hasAttribute('aria-busy'),'Busy state not released');
  return {label:body.querySelector('#reference-num').textContent};
});

await test('PDF cache hit avoids reopening and rescanning the reader',async()=>{
  Zotero.Prefs.set('refnexus.savePDFReferences',true);
  const body=await select(parent);body.setAttribute('source','PDF');
  await views.refreshReferences(body,false,false,false,parent,reader);
  const originalPDF=views.utils.PDF.getReferences,originalOpen=Zotero.Reader.open;
  let scans=0,opens=0;
  views.utils.PDF.getReferences=async()=>{scans++;throw new Error('Cache miss rescanned PDF')};
  Zotero.Reader.open=async()=>{opens++;throw new Error('Cache miss reopened reader')};
  try{const start=Date.now();await views.refreshReferences(body,true,false,false,parent);check(body.references?.length===6,'Cache result lost');check(!scans&&!opens,'Warm fetch touched reader');return {ms:Date.now()-start,scans,opens};}
  finally{views.utils.PDF.getReferences=originalPDF;Zotero.Reader.open=originalOpen;}
});

await test('file modification invalidates the PDF cache',async()=>{
  const body=await select(parent);body.setAttribute('source','PDF');
  const file=Zotero.File.pathToFile(await attachment.getFilePathAsync());const oldTime=file.lastModifiedTime;
  const original=views.utils.PDF.getReferences;let scans=0;
  views.utils.PDF.getReferences=async(...args)=>{scans++;return original.apply(views.utils.PDF,args)};
  try{file.lastModifiedTime=oldTime+5000;await views.refreshReferences(body,true,false,false,parent,reader);check(scans===1,'Modified file reused stale cache');return {scans};}
  finally{views.utils.PDF.getReferences=original;file.lastModifiedTime=oldTime;}
});

await test('a second PDF attachment has a distinct cache identity',async()=>{
  const second=await Zotero.Attachments.importFromFile({file:cfg.fixtures+'\\single.pdf',parentItemID:parent.id});
  const reader2=await Zotero.Reader.open(second.id);await delay(800);
  const a=await views.pdfCacheSignature(parent,reader),b=await views.pdfCacheSignature(parent,reader2);
  check(a!==b,'Different PDFs share one cache identity');
  const body=await select(parent);body.setAttribute('source','PDF');await views.refreshReferences(body,true,false,false,parent,reader2);
  check(body.references?.length===4,'Second attachment reused first attachment references');return {distinct:true,count:body.references.length};
});

await test('native PDF deadline covers a promise that never settles',async()=>{
  const fake={_iframeWindow:{PDFViewerApplication:{initializedPromise:Promise.resolve(),pdfDocument:{numPages:1,getPage:async()=>({getTextContent:()=>new Promise(()=>{})})}}}};
  const start=Date.now();let name;
  try{await views.utils.PDF.getReferences(fake,false,{notify:false,timeoutMs:80});}catch(error){name=error.name;}
  check(name==='TimeoutError','Never-settling extraction did not time out');check(Date.now()-start<1000,'Deadline exceeded');return {ms:Date.now()-start,name};
});

await test('native PDF cancellation handles a stalled text layer',async()=>{
  const fake={_iframeWindow:{PDFViewerApplication:{initializedPromise:Promise.resolve(),pdfDocument:{numPages:1,getPage:async()=>({getTextContent:()=>new Promise(()=>{})})}}}};
  const controller=new window.AbortController();const pending=views.utils.PDF.getReferences(fake,false,{notify:false,signal:controller.signal});
  window.setTimeout(()=>controller.abort(),30);let name;try{await pending;}catch(error){name=error.name;}
  check(name==='AbortError','Cancellation did not abort PDF extraction');return {name};
});

await test('twenty simultaneous fetches coalesce into one operation',async()=>{
  const original=views.utils.API.getDOIInfoByCrossref;let calls=0;
  views.utils.API.getDOIInfoByCrossref=async()=>{calls++;await delay(120);return {references:[{title:'Coalesced fixture',text:'Coalesced fixture citation 2024',identifiers:{}}]};};
  try{const body=await select(parent);body.setAttribute('source','API');await Promise.all(Array.from({length:20},()=>views.refreshReferences(body,false,false,false,parent)));check(calls===1,`Got ${calls} duplicate operations`);check(views.referenceTasks.size===0,'Coordinator retained finished task');return {calls};}
  finally{views.utils.API.getDOIInfoByCrossref=original;}
});

await test('thirty rapid item switches never commit stale results',async()=>{
  const original=views.utils.API.getDOIInfoByCrossref;
  views.utils.API.getDOIInfoByCrossref=async()=>{await delay(120);return {references:[{title:'STALE STRESS',text:'STALE STRESS citation 2024',identifiers:{}}]};};
  try{for(let i=0;i<30;i++){const body=await select(parent);body.setAttribute('source','API');const pending=views.refreshReferences(body,false,false,false,parent);await delay(5);await select(other);await pending;check(!body.querySelector('#related-grid').textContent.includes('STALE'),'Stale row committed');}check(!views.referenceTasks.size,'Leaked task');return {iterations:30};}
  finally{views.utils.API.getDOIInfoByCrossref=original;}
});

await test('cancel button releases native busy state and ignores late responses',async()=>{
  const original=views.utils.API.getDOIInfoByCrossref;
  views.utils.API.getDOIInfoByCrossref=async()=>{await delay(150);return {references:[{text:'CANCELLED LATE ROW',identifiers:{}}]};};
  try{const body=await select(parent);body.setAttribute('source','API');const pending=views.refreshReferences(body,false,false,false,parent);await delay(20);body.querySelector('#refnexus-cancel').click();check(!body.hasAttribute('aria-busy'),'Cancel left busy state');await pending;check(!body.references?.length,'Cancelled result committed');return {label:body.querySelector('#reference-num').textContent};}
  finally{views.utils.API.getDOIInfoByCrossref=original;}
});

await test('one thousand native rows yield to the UI event loop',async()=>{
  const original=views.utils.API.getDOIInfoByCrossref;
  views.utils.API.getDOIInfoByCrossref=async()=>({references:Array.from({length:1000},(_,i)=>({title:`Stress unique reference ${i}`,text:`Stress unique reference ${i} Journal 2024.`,identifiers:{}}))});
  let ticks=0;const interval=window.setInterval(()=>ticks++,10);
  try{const body=await select(parent);body.setAttribute('source','API');const start=Date.now();await views.refreshReferences(body,false,false,false,parent);check(body.querySelectorAll('.reference-text').length===1000,'Large render lost rows');check(ticks>0,'Event loop starved');return {rows:1000,ms:Date.now()-start,eventLoopTicks:ticks};}
  finally{window.clearInterval(interval);views.utils.API.getDOIInfoByCrossref=original;}
});

await test('real SQLite batch import deduplicates and rollback preserves existing data',async()=>{
  const existing=await make('Optical selection mechanisms of excitons '+stamp);
  const originalCol=new Zotero.Collection();originalCol.name='Original fixture '+stamp;await originalCol.saveTx();existing.addToCollection(originalCol.id);await existing.saveTx();
  parent.addRelatedItem(existing);existing.addRelatedItem(parent);await parent.saveTx();await existing.saveTx();
  const title='Distributed network cancellation invariants '+stamp;
  const refs=[{title:existing.getField('title'),identifiers:{}},{title,authors:['A <B>'],identifiers:{}},{title,identifiers:{}}];
  const result=await views.importReferences(parent,refs,{downloadOA:false});
  check(result.importedCount===1 && result.existingCount===2 && !result.failedCount,JSON.stringify(result));
  const colID=result.subCollection.id;const added=refs[1]._item;
  check(existing.getCollections().includes(colID),'Existing item missing in batch collection');check(parent.relatedItems.includes(added.key),'New item relation missing');
  const notes=await Zotero.Items.getAsync(parent.getNotes());const note=notes.find(n=>n.getTags().some(t=>t.tag==='refnexus:batch:'+result.batchId));
  check(note && !note.getNote().includes('<B>'),'Manifest note missing or unescaped');
  const removed=await views.rollbackReferences(parent,result.batchId);
  check(!parent.deleted && !existing.deleted,'Rollback trashed an original item');check(added.deleted && note.deleted,'New item/note not trashed');
  check(existing.getCollections().includes(originalCol.id) && !existing.getCollections().includes(colID),'Rollback changed original membership');
  check(parent.relatedItems.includes(existing.key) && existing.relatedItems.includes(parent.key),'Rollback erased original relations');
  check(!parent.relatedItems.includes(added.key),'Rollback left batch relation');
  check(await views.rollbackReferences(parent,result.batchId)===0,'Repeated rollback was not idempotent');
  return {imported:result.importedCount,existing:result.existingCount,removed,originalRelationsPreserved:true};
});

await test('rollback preserves a preexisting one-way relation',async()=>{
  const existing=await make('Asymmetric electronic boundary conditions '+stamp);parent.addRelatedItem(existing);await parent.saveTx();
  const result=await views.importReferences(parent,[{title:existing.getField('title'),identifiers:{}}],{downloadOA:false,createSubCollection:false,createManifestNote:false});
  check(existing.relatedItems.includes(parent.key),'Import did not add reverse relation');await views.rollbackReferences(parent,result.batchId);
  check(parent.relatedItems.includes(existing.key) && !existing.relatedItems.includes(parent.key),'Directional relation provenance lost');
});

await test('late translator results and concurrent imports cannot create duplicate database items',async()=>{
  const original=Zotero.Translate.Search;let metadataOnly=true;
  Zotero.Translate.Search=class{setIdentifier(){} async getTranslators(){return [{}]}setTranslator(){}async translate(options){metadataOnly=metadataOnly && options.libraryID===false && options.saveAttachments===false;await delay(180);return [{itemType:'journalArticle',title:'Late translator metadata'}];}};
  const doi='10.1234/fault-'+stamp;
  try{const refs1=[{title:'Native bounded translation fixture '+stamp,identifiers:{DOI:doi}}],refs2=[{title:refs1[0].title,identifiers:{DOI:doi}}];
    const results=await Promise.all([views.importReferences(parent,refs1,{downloadOA:false,createSubCollection:false,createManifestNote:false,translatorTimeoutMs:30}),views.importReferences(parent,refs2,{downloadOA:false,createSubCollection:false,createManifestNote:false,translatorTimeoutMs:30})]);await delay(220);
    const search=new Zotero.Search();search.libraryID=parent.libraryID;search.addCondition('DOI','is',doi);const ids=await search.search();
    check(metadataOnly,'Translator was allowed to save to the library');check(ids.length===1,`Late translator produced ${ids.length} items`);check(results[0].batchId!==results[1].batchId,'Batch IDs collided');check(results.reduce((n,r)=>n+r.importedCount,0)===1,'Concurrent imports created twice');
    await views.rollbackReferences(parent,results[1].batchId);await views.rollbackReferences(parent,results[0].batchId);return {databaseItemsBeforeRollback:ids.length,metadataOnly,batches:2};
  }finally{Zotero.Translate.Search=original;}
});

const HTTP=views.utils.API.requests.constructor;
const base='http://127.0.0.1:18796';
await test('real native XHR deduplication and cache hit issue one request',async()=>{
  const client=new HTTP();const url=base+'/ok?dedup='+stamp;
  try{const values=await Promise.all(Array.from({length:20},()=>client.get(url)));check(values.every(v=>v?.count===1),'Duplicate XHR requests');await client.get(url);return {...client.metrics};}finally{client.dispose();}
});
await test('native XHR retries transient 503 exactly twice',async()=>{
  const client=new HTTP({retryDelayMs:20,timeoutMs:500,budgetMs:1000});try{const value=await client.get(base+'/retry?test='+stamp);check(value?.count===3,'Unexpected retry count');check(client.metrics.retries===2,'Retries not bounded');return {...client.metrics};}finally{client.dispose();}
});
await test('native 404 is not retried',async()=>{
  const client=new HTTP({retryDelayMs:10});try{check(await client.get(base+'/missing?test='+stamp)===undefined,'404 returned success');check(client.metrics.requests===1,'404 retried');return {...client.metrics};}finally{client.dispose();}
});
await test('Retry-After longer than the budget exits without an early retry',async()=>{
  const client=new HTTP({budgetMs:200,retryDelayMs:10});try{const start=Date.now();await client.get(base+'/limited?test='+stamp);check(client.metrics.requests===1,'Ignored Retry-After');check(Date.now()-start<1000,'Nested native retry was not disabled');return {ms:Date.now()-start,...client.metrics};}finally{client.dispose();}
});
await test('native XHR timeout returns promptly and does not cache late responses',async()=>{
  const client=new HTTP({timeoutMs:80,budgetMs:200});try{const start=Date.now();check(await client.get(base+'/slow?test='+stamp)===undefined,'Slow request did not time out');check(Date.now()-start<1000,'Native XHR timeout exceeded');await delay(1600);check(client.cache.size===0,'Late response repopulated cache');return {requests:client.metrics.requests,cacheSize:client.cache.size};}finally{client.dispose();}
});
await test('actual network requests never exceed concurrency two',async()=>{
  const client=new HTTP({maxConcurrent:2});try{const values=await Promise.all(Array.from({length:8},(_,i)=>client.get(base+'/parallel?test='+stamp+'&i='+i)));check(values.every(v=>v),'Parallel request failed');check(Math.max(...values.map(v=>v.active))<=2,'Native HTTP concurrency exceeded');return {requests:8,maximumActive:Math.max(...values.map(v=>v.active))};}finally{client.dispose();}
});
await test('real open-access PDF download is awaited and recorded for rollback',async()=>{
  const ref={title:'Local open access attachment fixture '+stamp,identifiers:{},oaUrl:base+'/pdf?test='+stamp};
  const result=await views.importReferences(parent,[ref],{downloadOA:true});check(result.downloadCount===1 && !result.downloadFailedCount,JSON.stringify(result));
  const ids=ref._item.getAttachments();check(ids.length===1,'Downloaded attachment missing');const file=await Zotero.Items.getAsync(ids[0]);check(await file.fileExists(),'PDF file missing');
  await views.rollbackReferences(parent,result.batchId);check(file.deleted,'Downloaded attachment remained active after rollback');return {downloadCount:1};
});

await test('graph UI initializes lazily and its application loads in Zotero',async()=>{
  const frame=window.document.querySelector('#graph-view iframe');check(frame,'Graph iframe missing');check(!frame.getAttribute('src'),'Graph eagerly loaded before user request');
  const button=window.document.getElementById('refnexus-show-hide-graph-view');button.click();
  for(let i=0;i<100;i++){if(frame.contentWindow?.wrappedJSObject?.app)break;await delay(100);}
  check(frame.contentWindow?.wrappedJSObject?.app,'Graph application failed to load');button.click();return {appLoaded:true};
});
await test('cache flush persists an immediate shutdown-style write',async()=>{
  await views.storage.set(parent,'NativeFlush',{at:stamp});await views.storage.flush();const json=JSON.parse(await Zotero.File.getContentsAsync(views.storage.filename));check(json[parent.libraryID+':'+parent.key]?.NativeFlush?.at===stamp,'Immediate write was lost');return {persisted:true};
});
await select(parent);
report.finished=new Date().toISOString();report.passed=report.tests.filter(t=>t.ok).length;report.failed=report.tests.filter(t=>!t.ok).length;
await Zotero.File.putContentsAsync(cfg.output,JSON.stringify(report,null,2));
