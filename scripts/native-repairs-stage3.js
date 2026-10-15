if(!/refflow-z10-release-/.test(Zotero.DataDirectory.dir))throw new Error('Isolated profile required');
const views=Zotero.ZoteroRefFlow.views,stamp=Date.now(),report={version:Zotero.version,scope:'native DOM, SVG, SQLite and controlled transport; no live provider claims',tests:[]};
const check=(ok,text)=>{if(!ok)throw new Error(text);},delay=ms=>Zotero.Promise.delay(ms);
const save=()=>Zotero.File.putContentsAsync(cfg.output,JSON.stringify(report,null,2));
const test=async(name,run)=>{const start=Date.now();try{report.tests.push({name,ok:true,detail:await run(),ms:Date.now()-start});}catch(error){report.tests.push({name,ok:false,error:String(error),stack:error.stack});}await save();};
Zotero.Prefs.set('refflow.autoRefresh',false);
const parent=new Zotero.Item('journalArticle');parent.setField('title','Stage three fixture '+stamp);await parent.saveTx({skipSelect:true});await window.ZoteroPane.selectItem(parent.id);await delay(200);
const body=window.document.querySelector('item-pane-custom-section[data-pane$="-refflow-references"] [data-type="body"]');check(body,'Missing pane');
const rows=Array.from({length:2000},(_,i)=>({title:'Virtual reference '+i,text:'Complete bibliography line '+i,authors:[],identifiers:{},number:i+1}));
await test('2000-reference list mounts at most 60 cards and Ctrl+A/C copies the entire list',async()=>{
 body.references=rows;await views.sortReferences(body);const cards=body.querySelectorAll('.reference-item');check(cards.length===60,'DOM window not bounded: '+cards.length);
 let copied='';const original=views.utils.copyText;views.utils.copyText=text=>{copied=text;};
 try{cards[0].dispatchEvent(new window.KeyboardEvent('keydown',{key:'a',ctrlKey:true,bubbles:true}));cards[0].dispatchEvent(new window.KeyboardEvent('keydown',{key:'c',ctrlKey:true,bubbles:true}));check(copied.split('\n').length===2000,'Virtual copy dropped unmounted rows');}finally{views.utils.copyText=original;}
 return {references:2000,mounted:cards.length,copied:copied.split('\n').length};
});
await test('filtering reaches an unmounted row and restores full results with Escape',async()=>{
 const search=body.querySelector('input[type=search]');search.value='reference 1999';search.dispatchEvent(new window.Event('input',{bubbles:true}));await delay(150);
 const visible=[...body.querySelectorAll('.reference-item')].filter(row=>!row.hidden);check(visible.length===1&&visible[0].reference.title==='Virtual reference 1999','Offscreen search failed');
 search.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await delay(50);check(body.querySelectorAll('.reference-item').length===60,'Full window did not restore');return {offscreenMatch:1999,restored:true};
});
await test('native scrolling remounts a bounded later window',async()=>{
 const section=body.closest('item-pane-custom-section').querySelector('collapsible-section');section.open=true;
 const grid=body.querySelector('#related-grid');grid.scrollTop=144*1000;grid.dispatchEvent(new window.Event('scroll'));await delay(100);
 const cards=[...grid.querySelectorAll('.reference-item')];check(cards.length<=60&&Number(cards[0].dataset.referenceNumber)>900,'Scroll did not advance: '+cards[0]?.dataset.referenceNumber);
 return {mounted:cards.length,firstNumber:Number(cards[0].dataset.referenceNumber),scrollTop:grid.scrollTop};
});
await test('arrow navigation crosses a virtual window boundary',async()=>{
 const grid=body.querySelector('#related-grid'),cards=[...grid.querySelectorAll('.reference-item')],last=cards[cards.length-1],number=Number(last.dataset.referenceNumber);
 last.focus();last.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));await delay(80);
 check(Number(window.document.activeElement?.closest('.reference-item')?.dataset.referenceNumber)===number+1,'Keyboard did not focus next unmounted row');return {from:number,to:number+1};
});
await test('new graph starts empty and exposes a versioned renderer without sample papers',async()=>{
 window.document.getElementById('refflow-show-hide-graph-view').click();let frame,bridge;
 for(let i=0;i<100;i++){frame=window.document.querySelector('#graph-view iframe');bridge=frame?.contentWindow?.RefFlowGraph;if(bridge)break;await delay(50);}
 check(bridge?.version===1,'Renderer not ready');check(Object.keys(bridge.graphdata.nodes).length===0,'Unexpected sample papers');
 check(frame.contentDocument.querySelector('#empty')&&!frame.contentDocument.querySelector('#empty').hidden,'Missing empty state');return {version:bridge.version,nodes:0};
});
await test('SVG renderer validates and displays graph data with accessible node actions',async()=>{
 const frame=window.document.querySelector('#graph-view iframe'),bridge=frame.contentWindow.RefFlowGraph;
 const graph={nodes:{a:{title:'Native graph paper A',paperId:'a',year:2024,pos:[0,0]},b:{title:'Native graph paper B',paperId:'b',year:2023,pos:[1,1]}},edges:[['a','b',.5]]};
 bridge.setGraph(graph,{retrievedAt:new Date().toISOString()});check(frame.contentDocument.querySelectorAll('circle[role=button]').length===2,'Missing accessible graph nodes');
 let selected;const listener=event=>{selected=event.detail;};frame.contentWindow.addEventListener('refflow-graph-event',listener);
 try{frame.contentDocument.querySelector('circle').dispatchEvent(new frame.contentWindow.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));check(selected?.paperId==='a'&&selected.type==='select','Node keyboard activation failed');}
  finally{frame.contentWindow.removeEventListener('refflow-graph-event',listener);}
  try{
    const box=frame.getBoundingClientRect(),canvas=window.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=Math.ceil(box.width);canvas.height=Math.ceil(box.height);
    canvas.getContext('2d').drawWindow(window,box.x,box.y,canvas.width,canvas.height,'rgb(246,248,247)');const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    report.graphScreenshot=cfg.output.replace(/\.json$/,'.png');await IOUtils.write(report.graphScreenshot,new Uint8Array(await blob.arrayBuffer()));
  }catch(error){report.graphScreenshotError=String(error);}
 let rejected=false;try{bridge.setGraph({nodes:[],edges:[]});}catch{rejected=true;}check(rejected,'Malformed graph accepted');bridge.clear();return {nodes:2,edges:1,keyboard:true,invalidRejected:true};
});
await test('cancelling a waiting translator prevents any late item creation',async()=>{
 const native=Zotero.Translate.Search,controller=new window.AbortController();let release;
 Zotero.Translate.Search=class {setIdentifier(){}async getTranslators(){return ['controlled'];}setTranslator(){}async translate(){return new Promise(resolve=>{release=resolve;});}};
 const ref={title:'Cancelled native import '+stamp,authors:[],identifiers:{DOI:'10.1234/cancelled-'+stamp}};
 try{
   const job=views.importReferences(parent,[ref],{signal:controller.signal,downloadOA:false,createSubCollection:false,createManifestNote:false});
   for(let i=0;!release&&i<100;i++)await delay(10);check(release,'Translator did not start');controller.abort();const result=await job;
   check(result.cancelled===true&&result.importedCount===0&&!ref._item,'Cancelled import wrote an item');release([{itemType:'journalArticle',title:ref.title,DOI:ref.identifiers.DOI}]);await delay(60);
   check(!ref._item,'Late translator created an item');return {cancelled:true,created:0};
 }finally{Zotero.Translate.Search=native;}
});
await test('native clients share provider admission and release all slots',async()=>{
 const HTTP=views.utils.API.requests.constructor,a=new HTTP({maxConcurrent:2}),b=new HTTP({maxConcurrent:2}),original=Zotero.HTTP.request;let active=0,maximum=0;
 Zotero.HTTP.request=async()=>{active++;maximum=Math.max(maximum,active);await delay(15);active--;return {status:200,response:{ok:true}};};
 try{await Promise.all(Array.from({length:8},(_,i)=>(i%2?a:b).get('https://native-scheduler.test/'+i)));check(maximum===2,'Admission not shared: '+maximum);check(HTTP.sharedUsage.active===0&&HTTP.sharedUsage.queued===0,'Shared slots leaked');return {clients:2,maximum,usage:HTTP.sharedUsage};}
 finally{a.dispose();b.dispose();Zotero.HTTP.request=original;}
});
report.finished=new Date().toISOString();report.passed=report.tests.filter(row=>row.ok).length;report.failed=report.tests.filter(row=>!row.ok).length;report.errors=Zotero.getErrors(true).map(String);await save();
