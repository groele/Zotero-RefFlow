if(!/refflow-z10-release-/.test(Zotero.DataDirectory.dir))throw new Error('Isolated profile required');
const views=Zotero.ZoteroRefFlow.views,delay=ms=>Zotero.Promise.delay(ms),report={version:Zotero.version,at:new Date().toISOString(),scope:'Real isolated SQLite/DOM, controlled translator discovery and library permission response',tests:[]};
const check=(ok,text)=>{if(!ok)throw new Error(text);};
const save=()=>Zotero.File.putContentsAsync(cfg.output,JSON.stringify(report,null,2));
const test=async(name,run)=>{try{report.tests.push({name,ok:true,detail:await run()});}catch(error){report.tests.push({name,ok:false,error:String(error),stack:error.stack});}await save();};
const wait=async(fn)=>{for(let i=0;i<150;i++){if(fn())return;await delay(20);}throw new Error('Native lifecycle condition timed out');};
const make=async(title)=>{const item=new Zotero.Item('journalArticle');item.setField('title',title);await item.saveTx({skipSelect:true});return item;};
const select=async(parent)=>{await window.ZoteroPane.selectItem(parent.id);let body;await wait(()=>{body=window.document.querySelector('item-pane-custom-section[data-pane$="-refflow-references"] [data-type="body"]');return body?._cards&&body.getAttribute('data-refflow-item-id')===String(parent.id);});return body;};
const refs=(count,label)=>Array.from({length:count},(_,i)=>({title:label+' row '+i,text:label+' citation '+i,authors:[],number:i+1,identifiers:{}}));
const parent=await make('Lifecycle and virtual list acceptance');Zotero.Prefs.set('refflow.autoRefresh',false);window.Zotero_Tabs.select('zotero-pane');const body=await select(parent);body.closest('item-pane-custom-section').querySelector('collapsible-section').open=true;
const opts={downloadOA:false,createSubCollection:false,createManifestNote:false,collections:[]};

await test('a timed-out discovery cannot start native metadata resolution after the import settled',async()=>{
 const original=Zotero.Translate.Search;let release,requests=0;
 Zotero.Translate.Search=class{setIdentifier(value){this.doi=value.DOI;}getTranslators(){return new Promise(resolve=>release=resolve);}setTranslator(){}async translate(){requests++;return [{DOI:this.doi,title:'Late lookup'}];}};
 try{const rows=[{title:'Late discovery',identifiers:{DOI:'10.1234/lifecycle-discovery'}}],result=await views.importReferences(parent,rows,{...opts,translatorTimeoutMs:30});check(result.failedCount===1&&result.failures[0].code==='timeout','Discovery timeout did not fail');release(['late translator']);await delay(60);check(requests===0&&!rows[0]._item,'Late discovery launched a new request');return {requests,created:0};}
 finally{Zotero.Translate.Search=original;}
});
await test('explicit cancellation during discovery discards late discoveries without writes',async()=>{
 const original=Zotero.Translate.Search,controller=new window.AbortController();let release,requests=0;
 Zotero.Translate.Search=class{setIdentifier(){}getTranslators(){return new Promise(resolve=>release=resolve);}setTranslator(){}async translate(){requests++;return [];}};
 try{const rows=[{title:'Cancelled discovery',identifiers:{DOI:'10.1234/lifecycle-abort'}}],job=views.importReferences(parent,rows,{...opts,signal:controller.signal});await wait(()=>release);controller.abort();const result=await job;release(['late translator']);await delay(60);check(result.cancelled&&requests===0&&!rows[0]._item,'Aborted discovery resumed');return {cancelled:true,requests};}
 finally{Zotero.Translate.Search=original;}
});
await test('clearing one long list resets the virtual viewport for the next paper',async()=>{
 const rows=refs(2000,'First paper');body.references=rows;await body._cards.render(rows,()=>true);const grid=body.querySelector('#related-grid');grid.scrollTop=144*1000;grid.dispatchEvent(new window.Event('scroll'));await delay(100);check(Number(grid.querySelector('.reference-item').dataset.referenceNumber)>900,'Initial scroll failed');
 body._cards.clear();const next=refs(500,'Next paper');body.references=next;await body._cards.render(next,()=>true);const first=grid.querySelector('.reference-item');check(first.dataset.referenceNumber==='1'&&grid.scrollTop===0,'Old virtual viewport leaked into a different paper: '+JSON.stringify({first:first.dataset.referenceNumber,scrollTop:grid.scrollTop}));return {first:1,mounted:grid.querySelectorAll('.reference-item').length};
});
await test('a shorter refreshed long list mounts a full bounded final window',async()=>{
 const rows=refs(2000,'Before refresh');body.references=rows;body._cards.clear();await body._cards.render(rows,()=>true);const grid=body.querySelector('#related-grid');grid.scrollTop=144*1000;grid.dispatchEvent(new window.Event('scroll'));await delay(100);
 const next=refs(300,'After refresh');body.references=next;await body._cards.render(next,()=>true);const mounted=grid.querySelectorAll('.reference-item');check(mounted.length===60,'Refreshed list mounted only '+mounted.length+' rows');check(Number(mounted[0].dataset.referenceNumber)<=241,'Virtual window was clamped to a single last item');return {mounted:mounted.length,first:mounted[0].dataset.referenceNumber};
});
await test('scrolling the final virtual window settles without a remount loop',async()=>{
 const cards=body._cards,grid=body.querySelector('#related-grid'),original=cards.render;let renders=0;
 cards.render=function(...args){renders++;return original.apply(this,args);};
 try{grid.scrollTop=grid.scrollHeight;grid.dispatchEvent(new window.Event('scroll'));await delay(150);const settled=renders;await delay(150);check(renders===settled&&renders<=3,'Virtual tail repeatedly remounted: '+renders);check(grid.querySelectorAll('.reference-item').length===60,'Tail lost its bounded full window');return {renders,mounted:60};}
 finally{cards.render=original;}
});
await test('a filtered virtual result has filtered accessibility positions and original source numbering',async()=>{
 const rows=refs(2000,'Virtual accessibility');body._cards.clear();body.references=rows;await body._cards.render(rows,()=>true);const search=body.querySelector('input[type=search]');search.value='row 1999';search.dispatchEvent(new window.Event('input',{bubbles:true}));await wait(()=>body.querySelectorAll('.reference-item').length===1);
 const row=body.querySelector('.reference-item');check(row.dataset.referenceNumber==='2000','Original numbering lost');check(row.getAttribute('aria-posinset')==='1'&&row.getAttribute('aria-setsize')==='1','Filtered result announces the full bibliography size');search.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait(()=>body.querySelectorAll('.reference-item').length===60);const restored=body.querySelector('.reference-item');check(restored.dataset.referenceNumber==='1'&&restored.getAttribute('aria-setsize')==='2000','Cleared virtual filter did not restore accessible full-list state');return {source:2000,position:1,size:1,restoredSize:2000};
});
await test('a filtered short list also updates accessibility positions',async()=>{
 const rows=refs(20,'Short accessibility');body._cards.clear();body.references=rows;await body._cards.render(rows,()=>true);const search=body.querySelector('input[type=search]');search.value='row 17';search.dispatchEvent(new window.Event('input',{bubbles:true}));await wait(()=>[...body.querySelectorAll('.reference-item')].filter(row=>!row.hidden).length===1);
 const row=[...body.querySelectorAll('.reference-item')].find(row=>!row.hidden);check(row.dataset.referenceNumber==='18','Original numbering lost');check(row.getAttribute('aria-posinset')==='1'&&row.getAttribute('aria-setsize')==='1','Short filtered result retains stale accessibility size');search.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));check(body.querySelector('.reference-item').getAttribute('aria-setsize')==='20','Short-list accessible size did not restore');return {source:18,position:1,size:1,restoredSize:20};
});
await test('read-only destination preflight has a localized retryable UI failure',async()=>{
 const rows=[{title:'Read-only destination',identifiers:{DOI:'10.1234/lifecycle-readonly'}}];body._cards.clear();body.references=rows;await body._cards.render(rows,()=>true);const original=Zotero.Libraries.get,library=original.call(Zotero.Libraries,parent.libraryID),proxy=new Proxy(library,{get(target,key,receiver){return key==='editable'?false:Reflect.get(target,key,receiver);}});
 Zotero.Libraries.get=function(id){return id===parent.libraryID?proxy:original.call(this,id);};
 try{const action=body.querySelector('.reference-action');action.click();await wait(()=>!action.disabled);const text=body.querySelector('#reference-num').textContent;check(action.textContent==='!'&&!action.hasAttribute('aria-busy')&&!rows[0]._item,'Readonly failure state incorrect');check(text&&!text.includes('read-only')&&!text.includes('refflow-'),'Raw or missing permission error: '+text);return {created:0,message:text};}
 finally{Zotero.Libraries.get=original;}
});
report.finished=new Date().toISOString();report.passed=report.tests.filter(row=>row.ok).length;report.failed=report.tests.filter(row=>!row.ok).length;report.hostErrors=Zotero.getErrors(true).map(String);await save();
