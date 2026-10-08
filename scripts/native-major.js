if(!/refnexus-z10-release-/.test(Zotero.DataDirectory.dir))throw new Error('Isolated profile required');
const views=Zotero.ZoteroRefNexus.views,api=views.utils.API;
const report={version:Zotero.version,at:new Date().toISOString(),scope:'native DOM/SQLite/XHR; reference provider responses are controlled fixtures',tests:[]};
const delay=ms=>Zotero.Promise.delay(ms),check=(ok,message)=>{if(!ok)throw new Error(message);};
const save=()=>Zotero.File.putContentsAsync(cfg.output,JSON.stringify(report,null,2));
const test=async(name,fn)=>{const start=Date.now();try{report.tests.push({name,ok:true,ms:Date.now()-start,detail:await fn()});report.tests.at(-1).ms=Date.now()-start;}catch(error){report.tests.push({name,ok:false,error:String(error),stack:error.stack});}await save();};
Zotero.Prefs.set('refnexus.autoRefresh',false);Zotero.Prefs.set('refnexus.saveAPIReferences',false);
const parent=new Zotero.Item('journalArticle');parent.setField('title','Major release interaction fixture');parent.setField('DOI','10.1234/majorfixture');await parent.saveTx();
window.Zotero_Tabs.select('zotero-pane');await window.ZoteroPane.selectItem(parent.id);await delay(150);
const body=window.document.querySelector('item-pane-custom-section[data-pane$="-refnexus-references"] [data-type="body"]');check(body,'Native pane unavailable');body.setAttribute('source','API');body.setAttribute('data-refnexus-type','References');
const original=api.getReferenceList,stamp=Date.now();
const refs=Array.from({length:14},(_,i)=>({number:i+1,title:'Major reference '+i,text:'Major citation '+i,year:String(2000+i),identifiers:{DOI:'10.1234/major-'+stamp+'-'+i}}));
api.getReferenceList=async()=>({references:refs.map(ref=>({...ref,identifiers:{...ref.identifiers}})),source:'Controlled complete source'});
await views.refreshReferences(body,false,false,false,parent);
await test('refresh keeps existing cards usable until a replacement is ready',async()=>{
 let release;api.getReferenceList=async()=>new Promise(resolve=>{release=resolve;});const old=[...body.querySelectorAll('.reference-item')];const pending=views.refreshReferences(body,false,false,false,parent);for(let i=0;i<50&&!release;i++)await delay(10);
 check(body.hasAttribute('aria-busy')&&body.references.length===14,'Busy refresh discarded list');check(body.querySelector('.reference-item')===old[0],'Refresh removed existing DOM');release({references:refs.map(ref=>({...ref})),source:'Controlled complete source'});await pending;return {retainedCards:14};
});
await test('failed refresh retains the previous list and reports recovery',async()=>{
 api.getReferenceList=async()=>{throw new Error('Controlled offline provider');};const old=body.querySelector('.reference-item');await views.refreshReferences(body,false,false,false,parent);check(body.references.length===14&&body.querySelector('.reference-item')===old,'Offline failure cleared list');check(/保留|retained/i.test(body.querySelector('#reference-num').textContent),'No retained-results explanation');return {retained:true,label:body.querySelector('#reference-num').textContent};
});
await test('cancel preserves the previous list and rejects a late replacement',async()=>{
 let release;api.getReferenceList=async()=>new Promise(resolve=>{release=resolve;});const old=body.references;const pending=views.refreshReferences(body,false,false,false,parent);for(let i=0;i<50&&!release;i++)await delay(10);body.querySelector('#refnexus-cancel').click();check(!body.hasAttribute('aria-busy')&&body.references===old,'Cancel discarded completed list');release({references:[{title:'Cancelled replacement',identifiers:{}}],source:'Late'});await pending;check(body.references===old,'Cancelled response replaced cards');return {retained:true};
});
await test('successful refresh preserves filtered count, selection and focused reference',async()=>{
 api.getReferenceList=async()=>({references:refs.map(ref=>({...ref,identifiers:{...ref.identifiers}})),source:'Controlled complete source'});
 const search=body.querySelector('input[type=search]');search.value='major-';search.dispatchEvent(new window.Event('input',{bubbles:true}));await delay(100);const row=body.querySelectorAll('.reference-item')[2];row.dispatchEvent(new window.MouseEvent('click',{bubbles:true}));row.focus();await views.refreshReferences(body,false,false,false,parent);
 check(search.value==='major-','Query lost');const selected=body.querySelector('.reference-item.selected');check(selected?.reference.identifiers.DOI===refs[2].identifiers.DOI,'Selection lost');check(window.document.activeElement===selected,'Reference focus lost');check(body.querySelector('#reference-num').textContent.startsWith('14 / 14'),'Filtered count overwritten');search.value='';search.dispatchEvent(new window.Event('input',{bubbles:true}));await delay(100);return {selection:true,focus:true,filteredCount:true};
});
await test('sort is local and retains selection and source numbering',async()=>{
 let calls=0;api.getReferenceList=async()=>{calls++;throw new Error('Sorting must not fetch');};Zotero.Prefs.set('refnexus.sortBy','Recency');await views.sortReferences(body);check(calls===0,'Sort requested references');check(body.querySelector('.reference-number').textContent==='14.','Sort changed original numbers');check(body.querySelector('.reference-item.selected')?.reference.identifiers.DOI===refs[2].identifiers.DOI,'Sort lost selection');Zotero.Prefs.set('refnexus.sortBy','Original');await views.sortReferences(body);return {providerRequests:0};
});
await test('lazy library matching remains valid after the fetch task completes',async()=>{
 const local=new Zotero.Item('journalArticle');local.libraryID=parent.libraryID;local.setField('title',refs[13].title);local.setField('DOI',refs[13].identifiers.DOI);await local.saveTx();views.utils.clearLibraryItemCache();
 const cards=body._cards,queue=cards.queueLibraryMatch;let listCurrent;
 cards.queueLibraryMatch=function(row,item,current){listCurrent=current;return queue.call(this,row,item,current);};
 api.getReferenceList=async()=>({references:refs.map(ref=>({...ref,identifiers:{...ref.identifiers}})),source:'Controlled complete source'});
 try{await views.refreshReferences(body,false,false,false,parent);check(views.referenceTasks.size===0&&listCurrent?.(),'Committed list still depends on completed task');const last=body.querySelectorAll('.reference-item')[13];queue.call(cards,last,parent,listCurrent);cards.drainMatches();for(let i=0;i<50&&!last.reference._item;i++)await delay(20);check(last.reference._item?.id===local.id,'Delayed local match failed after fetch completion');return {taskFinished:true,localMatch:true,controlledIntersectionScheduling:true};}finally{cards.queueLibraryMatch=queue;}
});
await test('different literature types do not retain another type list',async()=>{
 const provider=api.openAlex.getNeighborhood;body.setAttribute('data-refnexus-type','Related');api.openAlex.getNeighborhood=async()=>{throw new Error('Controlled unavailable related service');};try{await views.refreshReferences(body,false,false,false,parent);check(!body.references.length&&!body.querySelector('.reference-item'),'References leaked into Related view');return {isolated:true};}finally{api.openAlex.getNeighborhood=provider;body.setAttribute('data-refnexus-type','References');}
});
api.getReferenceList=original;Zotero.Prefs.set('refnexus.saveAPIReferences',true);
const HTTP=api.requests.constructor,base='http://127.0.0.1:18796';
await test('two native consumers share XHR while cancelling only one remains isolated',async()=>{
 const client=new HTTP(),a=new window.AbortController(),b=new window.AbortController();try{const url=base+'/parallel?shared='+stamp;const first=client.get(url,'json',{},a.signal),second=client.get(url,'json',{},b.signal);a.abort();check(await first===undefined,'Cancelled consumer received result');const result=await second;check(result?.count===1&&client.metrics.requests===1,'Other consumer lost shared XHR');return {httpRequests:1,cancelledConsumers:1};}finally{client.dispose();}
});
await test('last-consumer cancellation physically aborts native XHR and leaves no cache',async()=>{
 const client=new HTTP({timeoutMs:10000}),controller=new window.AbortController();try{const pending=client.get(base+'/slow?last-consumer='+stamp,'json',{},controller.signal);await delay(30);const start=Date.now();controller.abort();await pending;await delay(20);check(!client.inFlight.size&&!client.cache.size&&!client.active,'Cancelled XHR remained active');check(Date.now()-start<500,'Cancellation waited for timeout');return {settledMs:Date.now()-start};}finally{client.dispose();}
});
await test('cancelled queued native XHR frees capacity before the active request completes',async()=>{
 const client=new HTTP({maxConcurrent:1,maxQueued:1}),controller=new window.AbortController();try{const active=client.get(base+'/parallel?queue-active='+stamp),queued=client.get(base+'/ok?queue-cancel='+stamp,'json',{},controller.signal);check(client.queue.length===1,'No queued fixture');controller.abort();await queued;check(client.queue.length===0&&client.metrics.requests===1,'Cancelled queue launched HTTP or kept capacity');await active;return {httpRequests:1};}finally{client.dispose();}
});
await test('optional enrichment timeout cancels its native child subscription',async()=>{
 const client=new HTTP({timeoutMs:10000});try{const start=Date.now();await api.optional(signal=>client.get(base+'/slow?optional='+stamp,'json',{},signal),40,undefined);await delay(20);check(!client.active&&!client.inFlight.size,'Optional timeout left HTTP work running');check(Date.now()-start<500,'Optional deadline exceeded');return {deadlineMs:40};}finally{client.dispose();}
});
await test('installed updater targets the user repository',async()=>{
 const {AddonManager}=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');const addon=await AddonManager.getAddonByID('refnexus@polygon.org');check(addon.version==='11.0.0','Wrong major package');check(addon.updateURL==='https://raw.githubusercontent.com/groele/Zotero-diy/main/RefNexus-Zotero10/update.json','Wrong update authority');return {pluginVersion:addon.version,updateURL:addon.updateURL};
});
report.finished=new Date().toISOString();report.passed=report.tests.filter(test=>test.ok).length;report.failed=report.tests.filter(test=>!test.ok).length;await save();
