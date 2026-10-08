// Real Zotero DOM/SQLite/XHR; provider substitutes below are controlled faults.
if(!/refnexus-z10-release-/.test(Zotero.DataDirectory.dir))throw new Error('Isolated profile required');
const views=Zotero.ZoteroRefNexus.views;
const report={version:Zotero.version,at:new Date().toISOString(),scope:'native Zotero DOM, cache and loopback XHR; explicitly controlled provider faults',tests:[]};
const delay=ms=>Zotero.Promise.delay(ms);
const check=(ok,message)=>{if(!ok)throw new Error(message);};
const save=()=>Zotero.File.putContentsAsync(cfg.output,JSON.stringify(report,null,2));
const test=async(name,fn)=>{const start=Date.now();try{const detail=await fn();report.tests.push({name,ok:true,ms:Date.now()-start,detail});}catch(error){report.tests.push({name,ok:false,ms:Date.now()-start,error:String(error),stack:error.stack});}await save();};
Zotero.Prefs.set('refnexus.autoRefresh',false);
const parent=new Zotero.Item('journalArticle');parent.setField('title','Native usability fixture');parent.setField('DOI','10.1234/usability');await parent.saveTx();
window.Zotero_Tabs.select('zotero-pane');await window.ZoteroPane.selectItem(parent.id);await delay(200);
const body=window.document.querySelector('item-pane-custom-section[data-pane$="-refnexus-references"] [data-type="body"]');check(body,'Native reference pane unavailable');
const refs=[{title:'Alpha fixture',text:'Alpha citation',identifiers:{}},{title:'Beta fixture',text:'Beta citation',identifiers:{}},{title:'Gamma fixture',text:'Gamma citation',identifiers:{}}];
const render=async(list)=>{body.references=list;await body._cards.render(list,()=>true);};
await test('search query survives refresh and Escape restores all stable numbered cards',async()=>{
 await render(refs);const search=body.querySelector('input[type=search]');search.value='beta';search.dispatchEvent(new window.Event('input',{bubbles:true}));await delay(120);
 await render(refs);check(search.value==='beta','Refresh discarded query');check([...body.querySelectorAll('.reference-item')].filter(row=>!row.hidden).length===1,'Refresh discarded filtering');
 search.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));check(search.value==='','Escape did not clear search');check([...body.querySelectorAll('.reference-item')].every(row=>!row.hidden),'Escape left hidden rows');
 check([...body.querySelectorAll('.reference-number')].map(row=>row.textContent).join(',')==='1.,2.,3.','Search changed numbering');return {retained:true,escape:true};
});
await test('empty search displays a localized recovery hint',async()=>{
 const search=body.querySelector('input[type=search]');search.value='no-such-reference';search.dispatchEvent(new window.Event('input',{bubbles:true}));await delay(120);
 const empty=body.querySelector('.refnexus-empty-result');check(empty&&!empty.hidden&&empty.textContent.includes('Esc'),'No empty-result recovery hint');search.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));check(empty.hidden,'Recovery hint remained visible');return {text:empty.textContent};
});
await test('Ctrl+C copies selection and Escape clears selection without changing references',async()=>{
 const rows=[...body.querySelectorAll('.reference-item')];rows[0].dispatchEvent(new window.MouseEvent('click',{bubbles:true}));const copy=views.utils.copyText;let copied;
 try{views.utils.copyText=text=>{copied=text;};rows[0].dispatchEvent(new window.KeyboardEvent('keydown',{key:'c',ctrlKey:true,bubbles:true,cancelable:true}));check(copied==='Alpha citation','Keyboard copy used wrong subset');rows[0].dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));check(!body.querySelector('.reference-item.selected'),'Escape left selection');return {copied};}finally{views.utils.copyText=copy;}
});
await test('action buttons retain native Enter handling and accessible labels',async()=>{
 const cards=body._cards,original=cards.open,action=body.querySelector('.reference-action');let rowOpens=0;cards.open=()=>{rowOpens++;};
 // Zotero itself may consume the key. Check only our row handler; suppress
 // synthetic default activation so this probe does not import a fixture.
 action.addEventListener('keydown',event=>event.preventDefault(),{once:true});
 try{action.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));check(rowOpens===0,'Row opened the reference instead of leaving the button key alone');check(action.getAttribute('aria-label')===action.title,'Accessible action label missing');return {rowNavigationCalls:rowOpens,accessibleLabel:true};}finally{cards.open=original;}
});
await test('an open context menu copies its original snapshot after the list changes',async()=>{
 const copy=views.utils.copyText;let copied;body._cards.menu();const popup=window.document.querySelector('menupopup[data-refnexus-menu=references]');check(popup,'Context menu missing');const command=popup.children[0];
 try{views.utils.copyText=text=>{copied=text;};await render([{title:'Changed list',text:'Wrong snapshot',identifiers:{}}]);command.dispatchEvent(new window.Event('command'));await delay(20);check(copied==='Alpha citation\nBeta citation\nGamma citation','Menu copied a later list');return {snapshotPreserved:true};}finally{views.utils.copyText=copy;popup.hidePopup();await render(refs);}
});
await test('automatic retrieval prefers a complete smaller source over partial PDF extraction',async()=>{
 const pdf=views.utils.PDF.getReferences,api=views.utils.API.getReferenceList;
 views.utils.PDF.getReferences=async()=>Array.from({length:8},(_,i)=>({number:i+2,title:'Partial '+i,identifiers:{}}));views.utils.API.getReferenceList=async()=>({references:Array.from({length:6},(_,i)=>({number:i+1,title:'Complete '+i,identifiers:{}})),source:'JATS controlled fixture'});
 try{const result=await views.smartReferences(parent,{}, {signal:new window.AbortController().signal,isCurrent:()=>true},true,false,body.querySelector('#reference-num'));check(result.references.length===6&&!result.partial&&result.source==='JATS controlled fixture','Larger partial PDF displaced complete source');return {count:6,source:result.source,faultInjection:true};}finally{views.utils.PDF.getReferences=pdf;views.utils.API.getReferenceList=api;}
});
await test('modern PathUtils cache persists under the native data directory',async()=>{
 await views.storage.set(parent,'ModernPath',{verified:true});await views.storage.flush();check(views.storage.filename.startsWith(Zotero.DataDirectory.dir),'Cache escaped data directory');check(Zotero.File.pathToFile(views.storage.filename).exists(),'Cache file absent');const json=JSON.parse(await Zotero.File.getContentsAsync(views.storage.filename));check(json[parent.libraryID+':'+parent.key].ModernPath.verified,'Native cache write lost');return {persisted:true};
});
const HTTP=views.utils.API.requests.constructor,base='http://127.0.0.1:18796',stamp=Date.now();
await test('real 429 suppresses repeated paths and a new credential can request immediately',async()=>{
 const client=new HTTP({budgetMs:200});try{await client.get(base+'/limited?usability='+stamp);check(client.metrics.requests===1,'429 retried');client.clearCache();await client.get(base+'/ok?cooldown='+stamp);check(client.metrics.requests===1&&client.metrics.cooldownHits===1,'Origin cooldown did not suppress another path');check(client.lastFailure.retryAfterMs>0,'No recovery timing');const value=await client.get(base+'/ok?new-key='+stamp,'json',{Authorization:'Bearer isolated-fixture'});check(value,'Fresh credential inherited cooldown');return {requests:client.metrics.requests,cooldownHits:client.metrics.cooldownHits};}finally{client.dispose();}
});
await test('disposal promptly settles active native XHR and queued requests',async()=>{
 const client=new HTTP({maxConcurrent:1,timeoutMs:10000});try{const active=client.get(base+'/slow?dispose='+stamp),queued=client.get(base+'/ok?queued='+stamp);await delay(30);const start=Date.now();client.dispose();const values=await Promise.all([active,queued]);check(values.every(value=>value===undefined),'Disposed transport returned data');check(Date.now()-start<500,'Shutdown waited for network timeout');check(!client.active&&!client.queue.length&&!client.inFlight.size,'Pending scheduler state leaked');return {settledMs:Date.now()-start};}finally{client.dispose();}
});
await test('disposal cancels a ten-second native retry backoff',async()=>{
 const client=new HTTP({retryDelayMs:10000});try{const pending=client.get(base+'/retry?backoff='+stamp);for(let i=0;i<100&&!client.metrics.retries;i++)await delay(10);check(client.metrics.retries===1,'No controlled retry entered');const start=Date.now();client.dispose();await pending;check(Date.now()-start<500,'Backoff blocked shutdown');check(client.metrics.requests===1,'Disposed client retried');return {settledMs:Date.now()-start};}finally{client.dispose();}
});
await test('native queue waiting reduces the remaining HTTP deadline',async()=>{
 const original=Zotero.HTTP.request,client=new HTTP({maxConcurrent:1,budgetMs:350,timeoutMs:350}),timeouts=[];
 Zotero.HTTP.request=function(method,url,options){if(url.includes('deadline='+stamp))timeouts.push(options.timeout);return original.call(this,method,url,options);};
 try{await Promise.all([client.get(base+'/parallel?deadline='+stamp+'&id=1'),client.get(base+'/parallel?deadline='+stamp+'&id=2')]);check(timeouts.length===2&&timeouts[1]<280,'Queue waiting received a new full budget');return {timeouts};}finally{client.dispose();Zotero.HTTP.request=original;}
});
await test('100 OpenAlex IDs use one selected-field batch request',async()=>{
 const Provider=views.utils.API.openAlex.constructor,urls=[];const provider=new Provider({get:async(url)=>{urls.push(url);return {results:Array.from({length:100},(_,i)=>({id:'https://openalex.org/W'+(i+1),title:'Batch fixture '+i}))};}});
 const result=await provider.hydrateBatch(Array.from({length:100},(_,i)=>'https://openalex.org/W'+(i+1)));check(urls.length===1&&urls[0].includes('per_page=100')&&result.length===100,'Hydration exceeded one request');return {requests:1,works:100,controlledProvider:true};
});
report.finished=new Date().toISOString();report.passed=report.tests.filter(test=>test.ok).length;report.failed=report.tests.filter(test=>!test.ok).length;await save();
