/* Real Zotero/SQLite acceptance. Never run against a user's normal profile. */
if(!/refflow-z10-release-/.test(Zotero.DataDirectory.dir))throw new Error('Isolated profile required');
const views=Zotero.ZoteroRefFlow.views,delay=ms=>Zotero.Promise.delay(ms);
const report={version:Zotero.version,at:new Date().toISOString(),scope:'Isolated native SQLite/UI; controlled translator results except explicitly named live checks',tests:[]};
const check=(ok,message)=>{if(!ok)throw new Error(message);};
const save=()=>Zotero.File.putContentsAsync(cfg.output,JSON.stringify(report,null,2));
const test=async(name,run)=>{const started=Date.now();try{report.tests.push({name,ok:true,detail:await run(),ms:Date.now()-started});}catch(error){report.tests.push({name,ok:false,error:String(error),stack:error?.stack,ms:Date.now()-started});}await save();};
const wait=async(fn)=>{for(let i=0;i<200;i++){if(fn())return;await delay(20);}throw new Error('Native condition timed out');};
const make=async(title,doi)=>{const item=new Zotero.Item('journalArticle');item.setField('title',title);if(doi)item.setField('DOI',doi);await item.saveTx({skipSelect:true});return item;};
const collection=async(name)=>{const item=new Zotero.Collection();item.libraryID=Zotero.Libraries.userLibraryID;item.name=name;await item.saveTx();return item;};
const ref=(doi,title='Provider abbreviated title')=>({title,authors:[],identifiers:doi?{DOI:doi}:{}});
const opts={downloadOA:false,createSubCollection:false,createManifestNote:false,collections:[]};
const native=Zotero.Translate.Search;
const controlled=async(run,handler)=>{
 let calls=0;const identifiers=[];
 Zotero.Translate.Search=class{
  setIdentifier(value){this.doi=value.DOI;identifiers.push(value.DOI);}
  async getTranslators(){return ['controlled'];}setTranslator(){}
  async translate(options){check(options.libraryID===false&&options.saveAttachments===false,'Translator performed unmanaged writes');calls++;return handler?handler(this.doi,calls):[{itemType:'journalArticle',DOI:this.doi,title:'Native resolved '+this.doi,creators:[{creatorType:'author',lastName:'Native'}]}];}
 };
 try{return await run({calls:()=>calls,identifiers});}finally{Zotero.Translate.Search=native;}
};
Zotero.Prefs.set('refflow.autoRefresh',false);
Zotero.Prefs.set('refflow.isShowTip',false);
const parent=await make('DOI workflow acceptance parent '+Date.now());
const select=async(item=parent)=>{window.Zotero_Tabs.select('zotero-pane');await window.ZoteroPane.selectItem(item.id);await delay(150);const body=window.document.querySelector('item-pane-custom-section[data-pane$="-refflow-references"] [data-type="body"]');check(body?._cards,'Missing native cards');return body;};
const runSuite=async(suite)=>test(suite,async()=>{
 const output=cfg.output.replace(/\.json$/,`-${suite}.json`),code=await Zotero.File.getContentsAsync(cfg.workspace+'\\scripts\\'+suite+'.js');
 await Object.getPrototypeOf(async function(){}).constructor('Zotero','window','cfg',code)(Zotero,window,{...cfg,output});
 const result=JSON.parse(await Zotero.File.getContentsAsync(output));check(result.failed===0,JSON.stringify(result.tests.filter(row=>!row.ok)));return {passed:result.passed,failed:result.failed};
});
// Its cold-start graph assertion must precede the graph fixture below.
await runSuite('native-repairs-stage3');
if(window.document.getElementById('graph-view')?.style.display!=='none')window.document.getElementById('refflow-show-hide-graph-view').click();

await test('normalized DOI aliases use one native lookup, SQLite item and undoable relation',()=>controlled(async c=>{
 const refs=[ref('https://doi.org/10.1234/NATIVE-ALIASES'),ref('10.1234/native-aliases')];
 const result=await views.importReferences(parent,refs,opts);check(result.importedCount===1&&result.existingCount===1&&c.calls()===1,JSON.stringify(result));
 check(refs[0]._item.id===refs[1]._item.id&&refs[0]._item.getField('title').startsWith('Native resolved'),'Provider stub or duplicate persisted');
 check(parent.relatedItems.includes(refs[0]._item.key),'Missing origin relation');
 await views.rollbackReferences(parent,result.batchId);check(refs[0]._item.deleted,'Unmodified exclusive creation not rolled back');return {new:1,existing:1,lookups:c.calls(),rollback:true};
}));
await test('balanced parentheses and legacy SICI survive the full native import',()=>controlled(async c=>{
 const dois=['10.1007/native(01)','10.1002/(sici)1097-0258(19981130)17:22<2625::aid-sim16>3.0.co;2-1'];
 const refs=dois.map(doi=>ref('('+doi+').'));const result=await views.importReferences(parent,refs,opts);
 check(result.importedCount===2,JSON.stringify(result));check(refs.every((row,i)=>row._item.getField('DOI')===dois[i]),'DOI suffix truncated');return {requested:c.identifiers};
}));
await test('unrelated first translator result does not hide the correct DOI',()=>controlled(async()=>{
 const refs=[ref('10.1234/native-multiple')];const result=await views.importReferences(parent,refs,opts);check(result.importedCount===1&&refs[0]._item.getField('title')==='Matching native title',JSON.stringify(result));return {matched:true};
},doi=>[{DOI:'10.1234/unrelated',title:'Unrelated'},{DOI:doi,title:'Matching native title'}]));
for(const [name,handler,code] of [
 ['missing DOI',()=>[{title:'No returned DOI'}],'identity'],
 ['conflicting DOI',()=>[{DOI:'10.1234/wrong',title:'Wrong work'}],'identity'],
 ['empty title',doi=>[{DOI:doi,title:'  '}],'metadata'],
 ['empty response',()=>[],'identity'],
 ['network rejection',()=>{throw new Error('Controlled network error');},'lookup']
])await test(name+' writes no item, collection or batch marker',()=>controlled(async()=>{
 const before=Number(await Zotero.DB.valueQueryAsync('SELECT COUNT(*) FROM items')),beforeCols=Number(await Zotero.DB.valueQueryAsync('SELECT COUNT(*) FROM collections')),extra=parent.getField('extra');
 const result=await views.importReferences(parent,[ref('10.1234/native-bad-'+code)],{...opts,createSubCollection:true,createManifestNote:true});
 check(result.failedCount===1&&result.failures[0].code===code,JSON.stringify(result));
 check(Number(await Zotero.DB.valueQueryAsync('SELECT COUNT(*) FROM items'))===before,'Partial item persisted');check(Number(await Zotero.DB.valueQueryAsync('SELECT COUNT(*) FROM collections'))===beforeCols,'Empty collection persisted');check(parent.getField('extra')===extra,'Empty journal persisted');return {created:0,code};
},handler));
await test('no DOI has a localized actionable failure and no translator request',()=>controlled(async c=>{
 const result=await views.importReferences(parent,[ref(undefined,'Missing identifier '+Date.now())],opts);check(result.failedCount===1&&result.failures[0].code==='no-doi'&&c.calls()===0,JSON.stringify(result));return {created:0,lookups:0};
}));
await test('external native import during metadata lookup is reused inside the transaction',async()=>{
 let release;return controlled(async c=>{
  const refs=[ref('10.1234/native-external')];const job=views.importReferences(parent,refs,opts);await wait(()=>release);
  const existing=await make('Added concurrently by another importer','10.1234/native-external');release([{DOI:'10.1234/native-external',title:'Native duplicate'}]);
  const result=await job;check(result.importedCount===0&&result.existingCount===1&&refs[0]._item.id===existing.id,JSON.stringify(result));
  await views.rollbackReferences(parent,result.batchId);check(!existing.deleted,'Rollback deleted external item');return {created:0,existing:1,externalPreserved:true};
 },()=>new Promise(resolve=>release=resolve));
});
await test('first item save failure atomically rolls back collection and journal; retry succeeds',()=>controlled(async()=>{
 const before=Number(await Zotero.DB.valueQueryAsync('SELECT COUNT(*) FROM items')),beforeCols=Number(await Zotero.DB.valueQueryAsync('SELECT COUNT(*) FROM collections')),extra=parent.getField('extra');
 const originalSave=Zotero.Item.prototype.save;let failed=false;
 Zotero.Item.prototype.save=function(...args){if(!this.id&&this.getField('DOI')==='10.1234/native-atomic'&&!failed){failed=true;throw new Error('Controlled item save failure');}return originalSave.apply(this,args);};
 let result;
 try{result=await views.importReferences(parent,[ref('10.1234/native-atomic')],{...opts,createSubCollection:true,createManifestNote:true});}finally{Zotero.Item.prototype.save=originalSave;}
 check(result.failedCount===1&&failed,JSON.stringify(result));check(Number(await Zotero.DB.valueQueryAsync('SELECT COUNT(*) FROM items'))===before,'Rolled back item remained');check(Number(await Zotero.DB.valueQueryAsync('SELECT COUNT(*) FROM collections'))===beforeCols,'Rolled back collection remained');check(parent.getField('extra')===extra,'Rolled back journal remained');
 const retry=await views.importReferences(parent,[ref('10.1234/native-atomic')],{...opts,createSubCollection:true,createManifestNote:true});check(retry.importedCount===1&&retry.subCollection,'Retry failed');return {atomic:true,retried:true};
}));
await test('collection removed while translator waits fails without changing destination',async()=>{
 const target=await collection('Removed destination');let release;return controlled(async()=>{
  const extra=parent.getField('extra');const job=views.importReferences(parent,[ref('10.1234/native-removed-target')],{...opts,collections:[target.id],createSubCollection:true});await wait(()=>release);await target.eraseTx();
  release([{DOI:'10.1234/native-removed-target',title:'Native'}]);const result=await job;check(result.failedCount===1&&result.failures[0].code==='destination'&&parent.getField('extra')===extra,JSON.stringify(result));return {created:0};
 },()=>new Promise(resolve=>release=resolve));
});
await test('timeout rejects late metadata and allows an explicit retry',async()=>{
 let release;return controlled(async()=>{
  const refs=[ref('10.1234/native-timeout')];const result=await views.importReferences(parent,refs,{...opts,translatorTimeoutMs:30});check(result.failedCount===1&&result.failures[0].code==='timeout',JSON.stringify(result));release([{DOI:refs[0].identifiers.DOI,title:'Late metadata'}]);await delay(70);check(!refs[0]._item,'Late result saved');
  return {timedOut:true,lateResultIgnored:true};
 },()=>new Promise(resolve=>release=resolve));
});
await test('queued cancellation is independent from an identical active request',async()=>{
 let release;return controlled(async()=>{
  const controller=new window.AbortController(),a=[ref('10.1234/native-signals')],b=[ref('10.1234/native-signals')];
  const first=views.importReferences(parent,a,opts);await wait(()=>release);const second=views.importReferences(parent,b,{...opts,signal:controller.signal});controller.abort();release([{DOI:a[0].identifiers.DOI,title:'Native'}]);
  const [one,two]=await Promise.all([first,second]);check(one.importedCount===1&&two.cancelled&&two.importedCount===0&&!b[0]._item,'Cancelled caller inherited success');return {created:1,otherCancelled:true};
 },()=>new Promise(resolve=>release=resolve));
});
await test('graph origins and selected collection share the DOI transaction and undo leases',()=>controlled(async()=>{
 const second=await make('Second graph origin'),target=await collection('Graph destination'),refs=[ref('10.1234/native-graph-origin')];
 const result=await views.importReferences(parent,refs,{...opts,relatedParents:[second],collections:[target.id]});const item=refs[0]._item;
 check(result.importedCount===1&&item.getCollections().includes(target.id)&&parent.relatedItems.includes(item.key)&&second.relatedItems.includes(item.key),'Graph links/target lost');
 await views.rollbackReferences(parent,result.batchId);check(item.deleted&&!parent.relatedItems.includes(item.key)&&!second.relatedItems.includes(item.key),'Graph rollback left ownership');return {origins:2,collection:true,rollback:true};
}));
await test('single-card double-click imports once into the captured collection with busy/retry state',()=>controlled(async c=>{
 const target=await collection('Single card active target');parent.addToCollection(target.id);await parent.saveTx();const body=await select();
 const refs=[ref('10.1234/native-card')];body.references=refs;await body._cards.render(refs,()=>true);const action=body.querySelector('.reference-action');
 action.click();action.click();check(action.disabled&&action.getAttribute('aria-busy')==='true','Missing busy state');await wait(()=>!action.disabled);
 check(refs[0]._item&&c.calls()===1&&refs[0]._item.getCollections().includes(target.id),'Duplicate import or wrong target');check(action.dataset.actionState==='open','Success action missing '+JSON.stringify({text:action.textContent,connected:action.isConnected,parent:parent.id,bodyParent:body.getAttribute('data-refflow-item-id'),selected:window.ZoteroPane.getSelectedItems().map(item=>item.id),actual:body.querySelector('.reference-action')?.textContent}));return {lookups:c.calls(),busy:true,collection:true};
}));
await test('switching items during local lookup cannot import or navigate from an old card',async()=>{
 const body=await select(),refs=[ref('10.1234/native-stale-click')];body.references=refs;await body._cards.render(refs,()=>true);
 const original=views.utils.searchLibraryItem;let release,imports=0;const originalImport=views.importReferences;
 views.utils.searchLibraryItem=()=>new Promise(resolve=>release=resolve);views.importReferences=async()=>{imports++;throw new Error('Stale import started');};
 try{const action=body.querySelector('.reference-action');action.click();await wait(()=>release);const other=await make('Different parent after click');await window.ZoteroPane.selectItem(other.id);await delay(100);release(undefined);await delay(100);check(imports===0&&!refs[0]._item,'Stale card started a write');return {imports:0};}
 finally{views.utils.searchLibraryItem=original;views.importReferences=originalImport;}
});
await test('batch menu captures selected rows, target and reports completion without refetch',()=>controlled(async c=>{
 const body=await select(),refs=[ref('10.1234/native-menu-a'),ref('10.1234/native-menu-b')];body.references=refs;await body._cards.render(refs,()=>true);
 const original=views.refreshReferences;let refreshes=0;views.refreshReferences=async()=>{refreshes++;};
 try{const rows=body.querySelectorAll('.reference-item');rows[0].dispatchEvent(new window.MouseEvent('click',{bubbles:true}));body._cards.menu();
  const menu=window.document.querySelector('menupopup[data-refflow-menu=references]');const action=[...menu.children].find(node=>/选中|selected|selezionat/i.test(node.getAttribute('label')||''));check(action,'Selected import command missing');action.dispatchEvent(new window.Event('command'));menu.hidePopup();
  await wait(()=>refs[0]._item);await wait(()=>!views.importJobs.size);check(!refs[1]._item&&c.calls()===1&&refreshes===0,'Batch selection or no-refetch contract broken');return {imported:1,unselected:0,refreshes};
 }finally{views.refreshReferences=original;}
}));

// Directly exercise the shipped graph action, including keyboard focusability.
await test('graph add action is a keyboard button and repeated click imports once',()=>controlled(async c=>{
 const originDOI='10.1234/native-graph-ui-source',nodeDOI='10.1234/native-graph-ui-node';
 const graph={start_id:'origin',nodes:{origin:{paperId:'origin',doi:originDOI,title:'Graph source',year:2024,pos:[0,0],authors:[]},node:{paperId:'node',doi:nodeDOI,title:'Graph node',year:2023,pos:[1,1],authors:[]}},edges:[['origin','node',0.5]],common_references:[],common_citations:[]};
 const original=Zotero.HTTP.request,oldKey=Zotero.Prefs.get('ConnectedPapers.accessToken'),originalImport=views.importReferences;let polls=0;const imports=[];
 views.importReferences=async(...args)=>{const result=await originalImport.apply(views,args);imports.push(result);return result;};
 views.utils.API.requests.clearCache();Zotero.Prefs.set('ConnectedPapers.accessToken','ISOLATED_TEST_KEY');
 Zotero.HTTP.request=async(method,url,options)=>{
  if(url.includes('api.semanticscholar.org/graph/v1/paper/DOI:'))return {status:200,response:{paperId:'origin',title:'Graph source',externalIds:{DOI:originDOI}}};
  if(url.includes('/papers-api/graph/')){polls++;return {status:200,response:{status:'FRESH_GRAPH',graph_json:graph}};}
  return original.call(Zotero.HTTP,method,url,options);
 };
 try{
  parent.setField('DOI',originDOI);await parent.saveTx();await select();if(window.document.getElementById('graph-view')?.style.display==='none')window.document.getElementById('refflow-show-hide-graph-view').click();await delay(180);
  window.document.getElementById('add-origin').click();await wait(()=>window.document.querySelector('.origin-items .item'));
  window.document.getElementById('build-graph').click();await wait(()=>window.document.querySelectorAll('.normal-items .item').length===2);
  const row=[...window.document.querySelectorAll('.normal-items .item')].find(node=>node._ref.identifiers.DOI===nodeDOI),action=row?.querySelector('button');
  check(action&&action.tabIndex>=0,'Graph action is not a focusable button');action.click();action.click();check(action.disabled&&action.getAttribute('aria-busy')==='true','Graph busy state missing');
  await wait(()=>!action.disabled);check(c.calls()===1&&row._ref._itemID,'Graph imported twice or failed '+JSON.stringify({calls:c.calls(),info:row._ref,imports,selected:window.ZoteroPane.getSelectedItems().map(item=>item.id)}));return {button:true,lookups:c.calls(),polls};
 }finally{Zotero.HTTP.request=original;views.importReferences=originalImport;Zotero.Prefs.set('ConnectedPapers.accessToken',oldKey||'');views.utils.API.requests.clearCache();const graphView=window.document.getElementById('graph-view');if(graphView&&graphView.style.display!=='none')window.document.getElementById('refflow-show-hide-graph-view').click();}
}));

if(!cfg.skipOnline)for(const doi of ['10.1038/nphys1170','10.1103/PhysRevLett.108.196802'])await test('LIVE native DOI translator '+doi,async()=>{
 check(Zotero.Translate.Search===native,'Native translator was not restored');
 const refs=[ref('https://doi.org/'+doi,'Provider title must not be used')];const result=await views.importReferences(parent,refs,{...opts,translatorTimeoutMs:45000});
 check(result.importedCount===1&&refs[0]._item&&refs[0]._item.getField('title')!=='Provider title must not be used',JSON.stringify(result));
 const item=refs[0]._item;const again=await views.importReferences(parent,[ref(doi)],opts);check(again.existingCount===1&&again.importedCount===0,'Online duplicate created');
 return {doi:item.getField('DOI'),title:item.getField('title'),creators:item.getCreators().length,existingOnRetry:true};
});

for(const suite of ['native-pipeline','native-dataflow'])await runSuite(suite);
report.finished=new Date().toISOString();report.passed=report.tests.filter(row=>row.ok).length;report.failed=report.tests.filter(row=>!row.ok).length;report.hostErrors=Zotero.getErrors(true).map(String);await save();
