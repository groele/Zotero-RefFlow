if(!/refflow-z10-release-/.test(Zotero.DataDirectory.dir))throw new Error('Isolated profile required');
const views=Zotero.ZoteroRefFlow.views,delay=ms=>Zotero.Promise.delay(ms),report={version:Zotero.version,at:new Date().toISOString(),tests:[]};
const check=(ok,message)=>{if(!ok)throw new Error(message);};
const save=()=>Zotero.File.putContentsAsync(cfg.output,JSON.stringify(report,null,2));
const test=async(name,fn)=>{try{report.tests.push({name,ok:true,detail:await fn()});}catch(error){report.tests.push({name,ok:false,error:String(error),stack:error.stack});}await save();};
const wait=async(fn)=>{for(let i=0;i<150;i++){if(fn())return;await delay(20);}throw new Error('UI state did not settle');};
const parent=new Zotero.Item('journalArticle');parent.setField('title','RefFlow DOI 导入原生界面验收');await parent.saveTx({skipSelect:true});
Zotero.Prefs.set('refflow.autoRefresh',false);window.restore();window.resizeTo(1160,900);window.Zotero_Tabs.select('zotero-pane');await window.ZoteroPane.selectItem(parent.id);await delay(200);
const body=window.document.querySelector('item-pane-custom-section[data-pane$="-refflow-references"] [data-type="body"]'),host=window.document.getElementById('zotero-item-pane');
check(body?._cards,'Cards unavailable');const section=body.closest('item-pane-custom-section');section.querySelector('collapsible-section').open=true;
const refs=[
 {title:'Coupled Spin and Valley Physics in Monolayers of MoS₂',text:'参考文献 1',authors:['Xiao, D.'],year:'2012',identifiers:{DOI:'10.1103/PhysRevLett.108.196802'}},
 {title:'A reference without a DOI — 缺少 DOI 时给出明确指引',text:'参考文献 2',authors:[],year:'2024',identifiers:{}},
 {title:'Balanced parentheses remain intact in DOI identifiers',text:'参考文献 3',authors:[],year:'2023',identifiers:{DOI:'10.1007/native-ui(01)'}}
];body.references=refs;await body._cards.render(refs,()=>true);body._setL10nArgs(JSON.stringify({count:refs.length}));body.querySelector('#reference-num').textContent=`${refs.length} · DOI`;
const screenshot=async(name)=>{section.scrollIntoView({block:'start'});await delay(100);const r=host.getBoundingClientRect();const canvas=window.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=Math.ceil(r.width);canvas.height=Math.ceil(r.height);canvas.getContext('2d').drawWindow(window,r.x,r.y,canvas.width,canvas.height,'rgb(255,255,255)');const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));const path=cfg.output.replace(/\.json$/,`-${name}.png`);await IOUtils.write(path,new Uint8Array(await blob.arrayBuffer()));return path;};
// layout.css.prefers-color-scheme.content-override is Gecko's native override:
// 0=dark, 1=light. It exercises actual host CSS/media queries in this test profile.
const oldScheme=Services.prefs.getIntPref('layout.css.prefers-color-scheme.content-override',2);
const oldSystemDark=Services.prefs.prefHasUserValue('ui.systemUsesDarkTheme')?Services.prefs.getIntPref('ui.systemUsesDarkTheme'):undefined;
try{
 for(const theme of ['light','dark'])for(const width of [480,280])await test(`native ${theme} cards, requested width ${width}px`,async()=>{
  Services.prefs.setIntPref('ui.systemUsesDarkTheme',theme==='dark'?1:0);Services.prefs.setIntPref('layout.css.prefers-color-scheme.content-override',theme==='dark'?0:1);host.style.width=width+'px';await delay(150);
  // Gecko may publish the native media-query change after a delayed preference
  // notification. Observe the real state instead of assuming a fixed 150 ms.
  await wait(()=>window.matchMedia('(prefers-color-scheme: dark)').matches===(theme==='dark'));
  check(window.matchMedia('(prefers-color-scheme: dark)').matches===(theme==='dark'),'Native theme override not applied');
  const grid=body.querySelector('#related-grid'),rows=[...body.querySelectorAll('.reference-item')];check(rows.length===3,'Missing cards');
  const geometries=rows.map(row=>{const action=row.querySelector('button'),r=row.getBoundingClientRect(),b=action.getBoundingClientRect();check(b.width>0&&b.left>=r.left&&b.right<=r.right+1,'Action clipped');check(action.getAttribute('aria-label'),'Missing action label');return {width:r.width,buttonWidth:b.width,font:window.getComputedStyle(action).fontSize};});
  check(grid.scrollWidth<=grid.clientWidth+1,'Horizontal card overflow');return {theme,width:host.getBoundingClientRect().width,geometries,screenshot:await screenshot(theme+'-'+width)};
 });
 await test('missing DOI shows a localized live status and stays retryable',async()=>{
  const row=body.querySelectorAll('.reference-item')[1],action=row.querySelector('button');action.click();await wait(()=>!action.disabled);
  check(action.textContent==='!'&&!action.hasAttribute('aria-busy'),'Failure not retryable');const label=body.querySelector('#reference-num');
  check(label.getAttribute('role')==='status'&&label.textContent.includes('DOI')&&!label.textContent.includes('refflow-'),'Unlocalized/missing status');
  check(!refs[1]._item,'Missing DOI created an item');return {message:label.textContent,screenshot:await screenshot('no-doi-error')};
 });
 await test('correcting DOI retries the same action and preserves the selected parent',async()=>{
  const original=Zotero.Translate.Search;let calls=0;
  Zotero.Translate.Search=class{setIdentifier(value){this.doi=value.DOI;}async getTranslators(){return ['controlled'];}setTranslator(){}async translate(options){calls++;check(options.libraryID===false&&!options.saveAttachments,'Unmanaged write');return [{itemType:'journalArticle',DOI:this.doi,title:'Native retry metadata',creators:[]}];}};
  try{refs[1].identifiers.DOI='10.1234/native-ui-retry';const action=body.querySelectorAll('.reference-item')[1].querySelector('button');action.click();await wait(()=>!action.disabled);
   check(refs[1]._item&&action.textContent==='↗'&&calls===1,'Retry did not show success');check(window.ZoteroPane.getSelectedItems()[0]?.id===parent.id,'Import stole selection');
   const message=body.querySelector('#reference-num').textContent;check(!message.includes('未创建')&&!message.includes('no item was created')&&message.includes('1'),'Successful retry kept a stale failure status');
   return {calls,selectedParent:parent.id,screenshot:await screenshot('retry-success')};
  }finally{Zotero.Translate.Search=original;}
 });
 await test('leave and return to item preserves a healthy reusable pane',async()=>{
  const other=new Zotero.Item('journalArticle');other.setField('title','Navigation fixture');await other.saveTx({skipSelect:true});await window.ZoteroPane.selectItem(other.id);await delay(100);await window.ZoteroPane.selectItem(parent.id);await delay(150);
  const next=window.document.querySelector('item-pane-custom-section[data-pane$="-refflow-references"] [data-type="body"]');check(next?._cards&&!next._cards.disposed&&next.getAttribute('data-refflow-item-id')===String(parent.id),'Pane failed on return');return {returned:true};
 });
}finally{Services.prefs.setIntPref('layout.css.prefers-color-scheme.content-override',oldScheme);if(oldSystemDark===undefined)Services.prefs.clearUserPref('ui.systemUsesDarkTheme');else Services.prefs.setIntPref('ui.systemUsesDarkTheme',oldSystemDark);}
await test('native-sidebar layout, multi-window and disable/re-enable suite',async()=>{
 const output=cfg.output.replace(/\.json$/,'-sidebar.json'),code=await Zotero.File.getContentsAsync(cfg.workspace+'\\scripts\\native-sidebar.js');
 await Object.getPrototypeOf(async function(){}).constructor('Zotero','window','cfg',code)(Zotero,window,{...cfg,output});
 const result=JSON.parse(await Zotero.File.getContentsAsync(output));check(result.failed===0,JSON.stringify(result.tests.filter(row=>!row.ok)));return {passed:result.passed,failed:result.failed};
});
report.finished=new Date().toISOString();report.passed=report.tests.filter(row=>row.ok).length;report.failed=report.tests.filter(row=>!row.ok).length;await save();
