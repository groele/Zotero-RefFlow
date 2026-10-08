if(!/refnexus-z10-release-/.test(Zotero.DataDirectory.dir))throw new Error('Isolated release profile required');
const report={version:Zotero.version,at:new Date().toISOString(),tests:[]};
const save=()=>Zotero.File.putContentsAsync(cfg.output,JSON.stringify(report,null,2));
const check=(ok,message)=>{if(!ok)throw new Error(message)};
const test=async(name,fn)=>{try{report.tests.push({name,ok:true,detail:await fn()});}catch(error){report.tests.push({name,ok:false,error:String(error),stack:error?.stack});}await save();};
const delay=ms=>Zotero.Promise.delay(ms);
const {AddonManager}=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
await test('production XPI cold startup with native sidebar and no debug bridge',async()=>{
  const addon=await AddonManager.getAddonByID('refnexus@polygon.org');check(addon?.isActive,'Production XPI not active');check(Zotero.ZoteroRefNexus?.views?.referenceTasks,'Plugin startup failed');check(Zotero.ZoteroRefNexus.data.env==='production','Not a production package');
  const errors=Zotero.getErrors(true);check(!errors.some(error=>/refnexus.js|refnexus@polygon.org/.test(error)),'Plugin startup errors');return {addonVersion:addon.version,env:Zotero.ZoteroRefNexus.data.env,errors};
});
for(const name of ['native-regression','native-stress','native-online','native-publishers']) {
  await test(name,async()=>{
    const output=cfg.output.replace(/\.json$/,`-${name}.json`);
    const code=await Zotero.File.getContentsAsync(cfg.workspace+'\\scripts\\'+name+'.js');
    await Object.getPrototypeOf(async function(){}).constructor('Zotero','window','cfg',code)(Zotero,window,{...cfg,output});
    const result=JSON.parse(await Zotero.File.getContentsAsync(output));check(result.failed===0,`${result.failed} native scenarios failed`);return {passed:result.passed,failed:result.failed};
  });
}
await test('XPI baseline layout: header icons, search, metadata cards, selection and filtering',async()=>{
  const views=Zotero.ZoteroRefNexus.views;window.Zotero_Tabs.select('zotero-pane');await delay(200);
  const item=new Zotero.Item('journalArticle');item.setField('title','Layout fixture parent');item.setField('DOI','10.1234/layoutparent');await item.saveTx();await window.ZoteroPane.selectItem(item.id);await delay(200);const body=window.document.querySelector('item-pane-custom-section[data-pane*="refnexus"] [data-type="body"]');
  const api=views.utils.API,original=api.getDOIInfoByCrossref;
  api.getDOIInfoByCrossref=async()=>({references:Array.from({length:4},(_,i)=>({title:'Layout fixture '+i,text:'Layout fixture citation '+i,authors:['Smith, J.'],year:String(2020+i),publicationVenue:'Native Journal',identifiers:{DOI:'10.1234/layout'+i},citationCount:i*3}))});
  try {
    body.setAttribute('source','API');body.setAttribute('data-refnexus-type','References');await views.refreshReferences(body,false,false,false,item);
    const rows=[...body.querySelectorAll('.reference-item')];check(rows.length===4,'Card layout missing');check(rows.every(row=>row.querySelector('.reference-title') && row.querySelector('.reference-about') && row.querySelector('.reference-action')),'Card metadata incomplete');
    check([...body.querySelectorAll('.header button')].filter(button=>!button.hidden).length===0,'Large action rows still present');
    rows[0].dispatchEvent(new window.MouseEvent('click',{bubbles:true}));rows[2].dispatchEvent(new window.MouseEvent('click',{bubbles:true,shiftKey:true}));check(body.querySelectorAll('.reference-item.selected').length===3,'Shift selection failed');
    rows[1].dispatchEvent(new window.MouseEvent('click',{bubbles:true,ctrlKey:true}));check(body.querySelectorAll('.reference-item.selected').length===2,'Ctrl toggle failed');
    rows[2].hidden=true;rows[1].dispatchEvent(new window.KeyboardEvent('keydown',{bubbles:true,key:'ArrowDown'}));check(window.document.activeElement===rows[3],'Keyboard navigation focused a hidden row');rows[2].hidden=false;
    const copy=views.utils.copyText;let copied='';try{views.utils.copyText=text=>{copied=text;};body.querySelector('#reference-num').dispatchEvent(new window.MouseEvent('dblclick'));check(copied.split('\n').length===4,'Double-click list copy not wired');}finally{views.utils.copyText=copy;}
    const search=body.querySelector('input[type=search]');search.value='layout3';search.dispatchEvent(new window.Event('input',{bubbles:true}));await delay(150);check(rows.filter(row=>!row.hidden).length===1,'Search did not filter cards');
    const section=body.closest('item-pane-custom-section');for(const type of ['type','refresh','more'])check(section.querySelector('collapsible-section .'+type),'Missing native header icon '+type);
    for(const filename of ['reference-sidenav.svg','reference.svg','type.svg','refresh.svg','more.svg']){const img=new window.Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('Icon failed: '+filename));img.src='chrome://refnexus/content/icons/'+filename;});check(img.naturalWidth>0,'Empty icon '+filename);}
    body._cards.menu();const popup=window.document.querySelector('menupopup[data-refnexus-menu=references]');check(popup,'Context menu missing');check([...popup.children].some(entry=>entry.getAttribute('label')?.includes('DOI')),'Copy DOI action missing');popup.hidePopup();return {cards:4,multiSelect:true,search:true,contextMenu:true};
  }finally{api.getDOIInfoByCrossref=original;}
});
await test('same-item native rerender preserves in-flight retrieval and literature type',async()=>{
 const views=Zotero.ZoteroRefNexus.views,item=window.ZoteroPane.getSelectedItems()[0],body=window.document.querySelector('item-pane-custom-section[data-pane*="refnexus"] [data-type="body"]'),api=views.utils.API,original=api.getDOIInfoByCrossref;
 body.setAttribute('data-refnexus-type','References');body.setAttribute('source','API');const cards=body._cards;
 api.getDOIInfoByCrossref=async()=>{await delay(150);return {references:[{text:'SAME ITEM RERENDER RESULT',identifiers:{}}]};};
 try{const pending=views.refreshReferences(body,false,false,false,item);await delay(20);const pane=body.closest('item-pane-custom-section');const props=pane._assembleProps(pane._getHookProps());pane._hooks.itemChange(props);pane._hooks.render(props);await pending;check(body._cards===cards,'Same-item rerender rebuilt card controller');check(body.references?.[0]?.text==='SAME ITEM RERENDER RESULT','Same-item rerender discarded result');check(body.querySelectorAll('.reference-item').length===1,'Result not rendered');return {preserved:true};}finally{api.getDOIInfoByCrossref=original;}
});
await test('native single-row import saves one item and one relation',async()=>{
  const item=window.ZoteroPane.getSelectedItems()[0];const body=window.document.querySelector('item-pane-custom-section[data-pane*="refnexus"] [data-type="body"]');
  const ref={title:'Single row layout import '+Date.now(),text:'Single row independent native layout fixture',identifiers:{}};
  await body._cards.render([ref],()=>true);body.querySelector('.reference-action').click();
  for(let i=0;i<100&&!ref._item;i++)await delay(50);
  check(ref._item && item.relatedItems.includes(ref._item.key),'Single-row import did not link to the bound item');return {saved:true};
});
await test('local library status and metadata hover require no enrichment requests',async()=>{
  const views=Zotero.ZoteroRefNexus.views,item=window.ZoteroPane.getSelectedItems()[0];
  const local=new Zotero.Item('journalArticle');local.setField('title','Local metadata hover fixture');local.setField('DOI','10.1234/hoverfixture');local.libraryID=item.libraryID;await local.saveTx();
  const body=window.document.querySelector('item-pane-custom-section[data-pane*="refnexus"] [data-type="body"]');const ref={title:'Local metadata hover fixture',text:'Hover reference fixture',identifiers:{DOI:'10.1234/hoverfixture'}};
  await body._cards.render([ref],()=>true);const section=body.closest('item-pane-custom-section').querySelector('collapsible-section');section.open=true;const row=body.querySelector('.reference-item');row.scrollIntoView();
  for(let i=0;i<50&&!ref._item;i++)await delay(50);check(ref._item?.id===local.id,'Visible card did not match local item');check(row.querySelector('.reference-action').textContent==='↗','Existing item action not updated');
  const before=views.utils.API.requests.metrics.requests;row.querySelector('.reference-title').dispatchEvent(new window.MouseEvent('mouseenter'));await delay(350);const tip=window.document.querySelector('.refnexus-tip-container');check(tip?.textContent.includes('Local metadata hover fixture'),'Metadata hover failed');check(views.utils.API.requests.metrics.requests===before,'Hover launched enrichment requests');body._cards.clear();return {localMatch:true,hover:true,enrichmentRequests:0};
});
await test('partial citation snapshot stays labeled and survives an offline force refresh',async()=>{
 const views=Zotero.ZoteroRefNexus.views,item=window.ZoteroPane.getSelectedItems()[0],body=window.document.querySelector('item-pane-custom-section[data-pane*="refnexus"] [data-type="body"]'),provider=views.utils.API.openAlex,original=provider.getNeighborhood;
 body.setAttribute('data-refnexus-type','Citations');body.setAttribute('source','API');provider.getNeighborhood=async()=>({references:[{title:'Partial snapshot reference',text:'Partial snapshot reference',identifiers:{}}],total:9,truncated:true});
 try{await views.refreshReferences(body,false,false,false,item);check(body.references?.length===1,'Partial result missing');check(body.getAttribute('data-refnexus-result-source').includes('1/9'),'Partial list falsely labeled complete');provider.getNeighborhood=async()=>{throw new Error('Controlled offline failure');};await views.refreshReferences(body,false,false,false,item);check(body.references?.length===1,'Offline refresh discarded valid cached list');check(body.querySelector('#reference-num').textContent.includes('缓存'),'Offline cache status missing');return {partial:'1/9',offlineRecovery:true};}finally{provider.getNeighborhood=original;body.setAttribute('data-refnexus-type','References');}
});
await test('second native main window has one pane and closing it preserves the plugin',async()=>{
  const item=window.ZoteroPane.getSelectedItems()[0];const other=window.openDialog('chrome://zotero/content/zoteroPane.xhtml','','chrome,dialog=no,resizable');
  try{for(let i=0;i<100&&(!other.ZoteroPane?.itemsView||!other.ZoteroPane?.collectionsView?.itemTreeView);i++)await delay(100);check(other.ZoteroPane?.itemsView,'Second window did not initialize');await other.ZoteroPane.selectItem(item.id);await delay(400);
    check(other.document.querySelectorAll('item-pane-custom-section[data-pane*="refnexus"]').length===1,'Duplicate or missing pane in second window');check(other.document.getElementById('refnexus-style'),'Card styles missing from second window');check(other.document.getElementById('refnexus-show-hide-graph-view'),'Graph button missing from second window');
  }finally{other.close();await delay(300);}
  check(Zotero.ZoteroRefNexus?.views,'Closing second window disposed shared plugin');return {windows:2,onePanePerWindow:true};
});
await test('native preference pane renders and saves the optional OpenAlex key',async()=>{
 const previous=Zotero.Prefs.get('refnexus.openAlexKey');const pref=Zotero.Utilities.Internal.openPreferences('refnexus-preferences');
 try{let input;for(let i=0;i<100;i++){input=pref.document.getElementById('refnexus-openalex-key');if(input)break;await delay(100);}check(input,'Key input missing from native preferences');check(input.type==='password','Key input not masked');input.value='isolated-test-key';input.dispatchEvent(new pref.Event('change',{bubbles:true}));await delay(150);check(Zotero.Prefs.get('refnexus.openAlexKey')==='isolated-test-key','Native preference field did not save');return {masked:true,saved:true};}
 finally{Zotero.Prefs.set('refnexus.openAlexKey',previous||'');pref.close();await delay(150);}
});
await test('disable and re-enable production XPI twice without duplicate panes',async()=>{
  const addon=await AddonManager.getAddonByID('refnexus@polygon.org');
  const startErrors=Zotero.getErrors(true).length;
  for(let cycle=0;cycle<2;cycle++){
    await addon.disable();await delay(300);check(!Zotero.ZoteroRefNexus,'Addon object remained after disable');
    await addon.enable();for(let i=0;i<100&&!Zotero.ZoteroRefNexus?.views?.referenceTasks;i++)await delay(100);check(Zotero.ZoteroRefNexus?.views?.referenceTasks,'Re-enable startup failed');
    const item=window.ZoteroPane.getSelectedItems()[0];await window.ZoteroPane.selectItem(item.id);await delay(200);
    const panes=window.document.querySelectorAll('item-pane-custom-section[data-pane*="refnexus"]');const contexts=new Set();for(const pane of panes){const context=pane.closest('item-details')||pane.parentElement;check(!contexts.has(context),'Duplicate section in the same item-details context');contexts.add(context);}check(panes.length>0,'No section after re-enable');
  }
  const errors=Zotero.getErrors(true).slice(startErrors);check(!errors.some(error=>/refnexus.js|refnexus@polygon.org|bootstrap/.test(error)),'Lifecycle errors detected');return {cycles:2,errors};
});
report.finished=new Date().toISOString();report.passed=report.tests.filter(test=>test.ok).length;report.failed=report.tests.filter(test=>!test.ok).length;
await save();
