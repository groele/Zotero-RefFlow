if(!/refflow-z10-release-/.test(Zotero.DataDirectory.dir))throw new Error('Isolated profile required');
const views=Zotero.ZoteroRefFlow.views,delay=ms=>Zotero.Promise.delay(ms),report={version:Zotero.version,tests:[]};
const check=(ok,msg)=>{if(!ok)throw new Error(msg);};
const wait=async(fn)=>{for(let n=0;n<100;n++){if(fn())return;await delay(20);}throw new Error('Focus did not settle');};
const test=async(name,fn)=>{try{await fn();report.tests.push({name,ok:true});}catch(e){report.tests.push({name,ok:false,error:String(e)});}await Zotero.File.putContentsAsync(cfg.output,JSON.stringify(report,null,2));};
Zotero.Prefs.set('refflow.autoRefresh',false);Zotero.Prefs.set('refflow.isShowTip',false);
const item=new Zotero.Item('journalArticle');item.setField('title','Keyboard UX isolated acceptance');await item.saveTx();window.Zotero_Tabs.select('zotero-pane');await window.ZoteroPane.selectItem(item.id);
let body;await wait(()=>{body=window.document.querySelector('item-pane-custom-section[data-pane$="-refflow-references"] [data-type="body"]');return body?._cards;});body.closest('item-pane-custom-section').querySelector('collapsible-section').open=true;
const cards=body._cards,grid=body.querySelector('#related-grid'),search=body.querySelector('input'),rows=()=>[...grid.querySelectorAll('.reference-item')],active=()=>window.document.activeElement,number=()=>Number(active()?.dataset.referenceNumber);
const key=(node,k,opts={})=>node.dispatchEvent(new window.KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true,...opts}));
const refs=Array.from({length:500},(_,n)=>({number:n+1,title:(n%2?'Odd ':'Even ')+'reference '+(n+1),text:'Citation '+(n+1),authors:[],identifiers:{}}));
const render=async(data=refs)=>{cards.clear();body.references=data;await cards.render(data,()=>true);rows()[0].focus();};
await test('End crosses the virtual window to the last reference',async()=>{await render();key(active(),'End');await wait(()=>number()===500);check(rows().length<=60,'Too many mounted cards');});
await test('Home crosses back to the first reference',async()=>{key(active(),'Home');await wait(()=>number()===1);});
await test('PageDown advances by the visible viewport',async()=>{await render();const expected=1+Math.max(1,Math.floor(Math.min(grid.clientHeight,window.innerHeight*0.65)/cards.rowHeight));key(active(),'PageDown');await wait(()=>number()===expected);});
await test('PageUp clamps at the first reference',async()=>{key(active(),'PageUp');await wait(()=>number()===1);});
await test('Space selects without activating the import button',async()=>{await render(refs.slice(0,6));const row=active();key(row,' ');check(row.getAttribute('aria-selected')==='true','Space did not select');check(!row.querySelector('button').disabled,'Unexpected import');});
await test('Ctrl Space toggles the focused selection',async()=>{key(active(),' ',{ctrlKey:true});check(active().getAttribute('aria-selected')==='false','Ctrl Space did not toggle');});
await test('Shift End extends selection across the virtual dataset',async()=>{await render();rows()[0].click();key(active(),'End',{shiftKey:true});await wait(()=>number()===500);check(cards.selected.size===500,'Range selection lost its anchor');});
await test('Filtered End uses filtered position and size',async()=>{await render();search.value='Even';search.dispatchEvent(new window.Event('input',{bubbles:true}));await delay(160);rows()[0].focus();key(active(),'End');await wait(()=>number()===499);check(active().getAttribute('aria-posinset')==='250'&&active().getAttribute('aria-setsize')==='250','Filtered accessibility mismatch');});
await test('Action button retains its own navigation keys',async()=>{const button=active().querySelector('button');button.focus();const accepted=key(button,'Home');check(accepted&&active()===button,'List intercepted button key');});
await test('Nonvirtual End and Home use visible rows',async()=>{await render(refs.slice(0,8));key(active(),'End');await wait(()=>number()===8);key(active(),'Home');await wait(()=>number()===1);});
await test('Existing arrows still navigate between adjacent cards',async()=>{key(active(),'ArrowDown');await wait(()=>number()===2);key(active(),'ArrowUp');await wait(()=>number()===1);});
await test('Switching hovered cards retires the previous tooltip removal timer',async()=>{
 await render(refs.slice(0,2));Zotero.Prefs.set('refflow.isShowTip',true);Zotero.Prefs.set('refflow.showTipAfterMillisecond',100);
 const original=views.showTipUI,tips=[];views.showTipUI=()=>{const tip={tipTimer:undefined,removeTipAfterMillisecond:350,cleared:0,clear(){this.cleared++;}};tips.push(tip);return tip;};
 try{const titles=rows().map(r=>r.querySelector('.reference-title'));titles[0].dispatchEvent(new window.MouseEvent('mouseenter'));await delay(140);check(tips.length===1,'First tip missing');titles[0].dispatchEvent(new window.MouseEvent('mouseleave'));titles[1].dispatchEvent(new window.MouseEvent('mouseenter'));await delay(140);check(tips.length===2,'Second tip missing');await delay(280);check(tips[1].cleared===0,'Old timer cleared the new tooltip');check(tips[0].cleared>0,'Previous tooltip was not retired');}
 finally{cards.clear();for(const tip of tips)globalThis.clearTimeout(tip.tipTimer);views.showTipUI=original;Zotero.Prefs.set('refflow.isShowTip',false);}
});
report.finished=new Date().toISOString();report.passed=report.tests.filter(x=>x.ok).length;report.failed=report.tests.filter(x=>!x.ok).length;await Zotero.File.putContentsAsync(cfg.output,JSON.stringify(report,null,2));
