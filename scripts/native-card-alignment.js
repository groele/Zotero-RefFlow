/* Native card geometry and interaction checks; never run in a normal profile. */
if(!/refflow-z10-release-/.test(Zotero.DataDirectory.dir))throw new Error('Isolated profile required');
const views=Zotero.ZoteroRefFlow.views,delay=ms=>Zotero.Promise.delay(ms),report={version:Zotero.version,at:new Date().toISOString(),scope:'Real isolated Zotero DOM/SQLite; controlled DOI result for icon-state transition',tests:[]};
const check=(ok,message,detail)=>{if(!ok){const error=new Error(message);error.detail=detail;throw error;}};
const save=()=>Zotero.File.putContentsAsync(cfg.output,JSON.stringify(report,null,2));
const test=async(name,run)=>{try{report.tests.push({name,ok:true,detail:await run()});}catch(error){report.tests.push({name,ok:false,error:String(error),detail:error.detail,stack:error.stack});}await save();};
const wait=async(fn)=>{for(let i=0;i<200;i++){if(fn())return;await delay(20);}throw new Error('Native card state did not settle');};
const make=async(title,doi)=>{const item=new Zotero.Item('journalArticle');item.setField('title',title);if(doi)item.setField('DOI',doi);await item.saveTx({skipSelect:true});return item;};
Zotero.Prefs.set('refflow.autoRefresh',false);Zotero.Prefs.set('refflow.isShowTip',false);window.restore();window.resizeTo(1160,980);window.Zotero_Tabs.select('zotero-pane');
const parent=await make('RefFlow 图标与标题对齐验收'),local=await make('Valley filter and valley valve in graphene','10.1234/alignment-existing');
await window.ZoteroPane.selectItem(parent.id);let body;
await wait(()=>{body=window.document.querySelector('item-pane-custom-section[data-pane$="-refflow-references"] [data-type="body"]');return body?._cards&&body.getAttribute('data-refflow-item-id')===String(parent.id);});
const host=window.document.getElementById('zotero-item-pane'),section=body.closest('item-pane-custom-section'),grid=body.querySelector('#related-grid');section.querySelector('collapsible-section').open=true;
const refs=[
 {number:1,title:local.getField('title'),text:'Rycerz, A., Tworzydło, J. & Beenakker, C. W. J. Valley filter and valley valve in graphene. Nat. Phys. 3, 172–175 (2007).',authors:['A. Rycerz'],year:'2007',publicationVenue:'Nat. Phys.',identifiers:{DOI:local.getField('DOI')},_item:local},
 {number:12,title:'Short reference title',text:'Smith, J. Short reference title. Journal, 2024.',authors:['J. Smith'],year:'2024',identifiers:{}},
 {number:128,title:'Long English title mixed with 中文标题：窄窗口中的箭头与状态点应始终对应同一篇文献',text:'A long original citation with additional authors and publication information, 2025.',authors:['L. Author'],year:'2025',identifiers:{},retraction:{isRetracted:true,reason:'Controlled provider warning'}},
 {number:1000,title:'Only a title is available',text:'',authors:[],identifiers:{}}
];
const render=async(rows=refs)=>{body._cards.clear();body.references=rows;await body._cards.render(rows,()=>true);body._setL10nArgs?.(JSON.stringify({count:rows.length}));body.querySelector('#reference-num').textContent=rows.length+' · DOI';};
const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,left:r.left,right:r.right,top:r.top,bottom:r.bottom};};
const center=node=>{const r=node.getBoundingClientRect();return r.top+r.height/2;};
const geometry=row=>{
 const title=row.querySelector('.reference-title'),action=row.querySelector('.reference-action'),dot=row.querySelector('.reference-state'),text=row.querySelector('.reference-text'),about=row.querySelector('.reference-about'),r=rect(title),line=parseFloat(window.getComputedStyle(title).lineHeight),firstCenter=r.top+line/2;
 return {source:row.dataset.referenceNumber,row:rect(row),title:r,action:rect(action),citation:rect(text),metadata:rect(about),dotDelta:Math.abs(center(dot)-firstCenter),actionDelta:Math.abs(center(action)-firstCenter),svg:!!action.querySelector('svg'),state:action.dataset.actionState};
};
const validate=row=>{
 const g=geometry(row);check(g.dotDelta<=1&&g.actionDelta<=1,'State/action not aligned to first title line',g);
 check(g.svg,'Action uses a font glyph instead of a stable SVG',g);
 check(g.action.width>=24&&g.action.height>=24&&g.action.right<=g.row.right+.5&&g.action.left>=g.title.right-.5,'Action hit area is clipped or overlaps the title',g);
 check(g.citation.bottom<=g.title.top+1,'Citation and title overlap',g);
 check(Math.abs(g.title.left-g.citation.left)<1&&(!row.querySelector('.reference-about').textContent||Math.abs(g.metadata.left-g.title.left)<1),'Text columns do not align',g);
 check(g.title.bottom<=g.row.bottom+1&&g.action.bottom<=g.row.bottom+1&&(!row.querySelector('.reference-about').textContent||g.metadata.bottom<=g.row.bottom+1),'Title, metadata or action escapes its card',g);
 check(row.querySelector('button').getAttribute('aria-label')&&row.querySelector('svg').getAttribute('aria-hidden')==='true','Action name or decorative icon semantics missing',g);
 return g;
};
const screenshot=async(name)=>{section.scrollIntoView({block:'start'});await delay(80);const r=host.getBoundingClientRect(),canvas=window.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=Math.ceil(r.width);canvas.height=Math.ceil(r.height);canvas.getContext('2d').drawWindow(window,r.x,r.y,canvas.width,canvas.height,'rgb(255,255,255)');const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png')),path=cfg.output.replace(/\.json$/,`-${name}.png`);await IOUtils.write(path,new Uint8Array(await blob.arrayBuffer()));if(name==='light-280-1'||name==='dark-280-1'){const card=grid.querySelector('.reference-item').getBoundingClientRect(),preview=window.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');preview.width=Math.ceil(card.width);preview.height=Math.ceil(card.height);preview.getContext('2d').drawWindow(window,card.x,card.y,preview.width,preview.height,'rgb(255,255,255)');const image=await new Promise(resolve=>preview.toBlob(resolve,'image/png'));await IOUtils.write(cfg.output.replace(/\.json$/,`-card-${name}.png`),new Uint8Array(await image.arrayBuffer()));}return path;};
const oldScheme=Services.prefs.getIntPref('layout.css.prefers-color-scheme.content-override',2),oldSystemDark=Services.prefs.prefHasUserValue('ui.systemUsesDarkTheme')?Services.prefs.getIntPref('ui.systemUsesDarkTheme'):undefined,baseFont=parseFloat(window.getComputedStyle(body).fontSize);
try{
 for(const theme of ['light','dark'])for(const width of [480,280])for(const scale of [1,1.35])await test(`${theme}, requested ${width}px, text scale ${scale}`,async()=>{
  Services.prefs.setIntPref('ui.systemUsesDarkTheme',theme==='dark'?1:0);Services.prefs.setIntPref('layout.css.prefers-color-scheme.content-override',theme==='dark'?0:1);await wait(()=>window.matchMedia('(prefers-color-scheme: dark)').matches===(theme==='dark'));
  host.style.width=width+'px';body.style.fontSize=baseFont*scale+'px';await render();await delay(80);const path=await screenshot(theme+'-'+width+'-'+scale);
  const rows=[...grid.querySelectorAll('.reference-item')],geometries=rows.map(validate);check(grid.scrollWidth<=grid.clientWidth+1,'Horizontal list overflow');
  check(geometries[0].state==='open'&&geometries[1].state==='add','Local match and add state mismatch',geometries);
  return {requestedWidth:width,actualHostWidth:host.getBoundingClientRect().width,theme,textScale:scale,geometries,screenshot:path};
 });
 body.style.fontSize=baseFont+'px';host.style.width='360px';
 await test('busy, retryable failure, add and open icons retain the same geometry',async()=>{
  const row={title:'Retry alignment',text:'Citation of retry alignment',authors:[],identifiers:{}},original=Zotero.Translate.Search;await render([row]);const card=grid.querySelector('.reference-item'),action=card.querySelector('button'),states=[geometry(card)];
  action.click();await wait(()=>!action.disabled);states.push(geometry(card));check(action.dataset.actionState==='error','Failure did not remain retryable');
  let release;Zotero.Translate.Search=class{setIdentifier(value){this.doi=value.DOI;}async getTranslators(){return ['controlled'];}setTranslator(){}async translate(){return new Promise(resolve=>{release=()=>resolve([{itemType:'journalArticle',DOI:this.doi,title:'Retry alignment metadata'}]);});}};
  try{row.identifiers.DOI='10.1234/alignment-retry';action.click();await wait(()=>release);states.push(geometry(card));release();await wait(()=>!action.disabled);states.push(geometry(card));
   check(row._item&&!row._item.deleted&&action.dataset.actionState==='open','Retry did not reach the local item');check(states.map(state=>state.state).join(',')==='add,error,busy,open','Incorrect icon states',states);
   check(states.every(state=>state.svg&&state.actionDelta<=1&&Math.abs(state.action.width-states[0].action.width)<.1&&Math.abs((state.action.y-state.row.y)-(states[0].action.y-states[0].row.y))<.1),'Icon state changed geometry',states);return {states};
  }finally{if(release)release();Zotero.Translate.Search=original;}
 });
 await test('double-clicking an action does not trigger the card double-click handler',async()=>{
  await render();const card=grid.querySelector('.reference-item'),action=card.querySelector('button'),cards=body._cards,original=cards.open;let opened=0;cards.open=()=>opened++;
  try{action.dispatchEvent(new window.MouseEvent('dblclick',{bubbles:true}));const fromAction=opened;card.dispatchEvent(new window.MouseEvent('dblclick',{bubbles:true}));check(fromAction===0&&opened===1,'Action double click leaked into card navigation',{fromAction,total:opened});return {fromAction,rowOpens:opened};}
  finally{cards.open=original;}
 });
 await test('reference-card CSS stays inside the RefFlow pane',async()=>{
  const container=window.document.createElement('div');container.className='zotero-editpane-related';const outside=window.document.createElement('div');outside.className='reference-item';outside.innerHTML='<button class="reference-action">External control</button>';container.append(outside);window.document.documentElement.append(container);
  try{check(window.getComputedStyle(outside).display==='block','Card layout leaked outside plugin root',{display:window.getComputedStyle(outside).display});return {outsideDisplay:'block'};}
  finally{container.remove();}
 });
 for(const scale of [1,1.35])await test('a virtual list preserves visible actions and bounded rows at text scale '+scale,async()=>{
  body.style.fontSize=baseFont*scale+'px';
  const rows=Array.from({length:2000},(_,i)=>({...refs[i%refs.length],number:i+1,title:'Virtual '+(i+1)+' '+refs[i%refs.length].title}));await render(rows);check(grid.querySelectorAll('.reference-item').length===60,'Virtual mount bound lost');for(const row of [...grid.querySelectorAll('.reference-item')].slice(0,4))validate(row);
  grid.scrollTop=grid.scrollHeight;grid.dispatchEvent(new window.Event('scroll'));await delay(100);const mounted=[...grid.querySelectorAll('.reference-item')];check(mounted.length===60&&mounted.at(-1).dataset.referenceNumber==='2000','Virtual tail or source numbering failed');for(const row of mounted.slice(-4))validate(row);return {mounted:60,lastSource:2000};
 });
}finally{body.style.fontSize='';Services.prefs.setIntPref('layout.css.prefers-color-scheme.content-override',oldScheme);if(oldSystemDark===undefined)Services.prefs.clearUserPref('ui.systemUsesDarkTheme');else Services.prefs.setIntPref('ui.systemUsesDarkTheme',oldSystemDark);}
await test('existing native source-numbering, search and selection suite',async()=>{
 const output=cfg.output.replace(/\.json$/,'-numbering.json'),code=await Zotero.File.getContentsAsync(cfg.workspace+'\\scripts\\native-numbering.js');await Object.getPrototypeOf(async function(){}).constructor('Zotero','window','cfg',code)(Zotero,window,{...cfg,output});const result=JSON.parse(await Zotero.File.getContentsAsync(output));check(result.failed===0,JSON.stringify(result.tests.filter(row=>!row.ok)));return {passed:result.passed,failed:result.failed};
});
report.finished=new Date().toISOString();report.passed=report.tests.filter(row=>row.ok).length;report.failed=report.tests.filter(row=>!row.ok).length;report.hostErrors=Zotero.getErrors(true).map(String);await save();
