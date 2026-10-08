if(!/refnexus-z10-release-/.test(Zotero.DataDirectory.dir))throw new Error('Isolated profile required');
const report={version:Zotero.version,at:new Date().toISOString(),tests:[]};
const check=(ok,message)=>{if(!ok)throw new Error(message);};
const delay=ms=>Zotero.Promise.delay(ms);
const save=()=>Zotero.File.putContentsAsync(cfg.output,JSON.stringify(report,null,2));
const test=async(name,fn)=>{try{report.tests.push({name,ok:true,detail:await fn()});}catch(error){report.tests.push({name,ok:false,error:String(error),stack:error?.stack});}await save();};
const {AddonManager}=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
const regular=new Zotero.Item('journalArticle');regular.setField('title','Native sidebar geometry regression');await regular.saveTx();
const note=new Zotero.Item('note');note.setNote('<p>Native note layout fixture</p>');await note.saveTx();
window.Zotero_Tabs.select('zotero-pane');await window.ZoteroPane.selectItem(regular.id);await delay(300);
const measure=win=>{
 const doc=win.document,host=doc.getElementById('zotero-item-pane'),content=doc.getElementById('zotero-item-pane-content'),rail=doc.getElementById('zotero-view-item-sidenav');
 const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right};};
 return {orient:host.getAttribute('orient'),direction:win.getComputedStyle(host).flexDirection,host:rect(host),content:rect(content),rail:rect(rail),children:[...host.children].map(node=>node.id)};
};
const checkLayout=win=>{
 const m=measure(win);check(m.direction==='row','Host is no longer horizontal: '+JSON.stringify(m));
 check(Math.abs(m.content.y-m.rail.y)<1,'Rail moved below content');check(m.rail.x>=m.content.right-1,'Rail overlaps content');
 check(Math.abs(m.rail.right-m.host.right)<1,'Rail is not at the right edge');check(Math.abs(m.rail.width-37)<1,'Native 37px rail width changed');
 check(Math.abs(m.rail.height-m.host.height)<1,'Rail height no longer matches host');
 check(JSON.stringify(m.children)===JSON.stringify(['zotero-item-pane-content','zotero-view-item-sidenav']),'Foreign node inserted between host deck and rail');return m;
};
const graphSection=win=>win.document.querySelector('#zotero-item-details item-pane-custom-section[data-pane$="-refnexus-graph"]');
const graphButton=win=>win.document.getElementById('refnexus-show-hide-graph-view');
await test('cold production startup retains Zotero native sidebar geometry',async()=>{
 const addon=await AddonManager.getAddonByID('refnexus@polygon.org');check(addon?.version==='10.3.2'&&addon.isActive,'Wrong production XPI');
 check(graphSection(window)?.hidden,'Graph section should be hidden by default');return {addonVersion:addon.version,...checkLayout(window)};
});
await test('reference icon uses a tooltip without a visible label',async()=>{
 const button=window.document.querySelector('#zotero-view-item-sidenav [data-pane$="-refnexus-references"]');check(button,'Reference sidenav entry missing');
 await window.document.l10n.translateElements([button]);check(button.getAttribute('tooltiptext')?.trim(),'Missing tooltip');check(!button.getAttribute('label'),'Visible text added to icon rail');return {tooltip:button.getAttribute('tooltiptext')};
});
await test('graph open mounts the related list only inside a native custom section',async()=>{
 graphButton(window).click();await delay(300);const section=graphSection(window);check(section&&!section.hidden,'Graph native section did not open');
 const panel=window.document.getElementById('connected-papers-relatedsplit-after');check(panel?.closest('item-pane-custom-section')===section,'Related panel outside native section');
 check(section.querySelector('#refnexus-related-container'),'Related controls missing');check(window.document.getElementById('graph-view')?.style.display!=='none','Main graph did not open');
 return {geometry:checkLayout(window),panelParent:panel.parentElement.localName};
});
await test('repeated graph toggles preserve host geometry and do not duplicate panels',async()=>{
 for(let i=0;i<4;i++){graphButton(window).click();await delay(100);checkLayout(window);}
 check(!graphSection(window).hidden,'Toggle state lost');check(window.document.querySelectorAll('#connected-papers-relatedsplit-after').length===1,'Duplicate related panel');return {toggles:4};
});
await test('narrow and wide item panes retain the icon rail at the right edge',async()=>{
 const host=window.document.getElementById('zotero-item-pane'),old=host.style.width,details=[];
 try{for(const width of [260,357,480]){host.style.width=width+'px';await delay(150);details.push(checkLayout(window));}}finally{host.style.width=old;}return {widths:details.map(m=>m.host.width),geometries:details};
});
await test('note and regular-item switching keeps native layout and graph availability',async()=>{
 await window.ZoteroPane.selectItem(note.id);await delay(150);checkLayout(window);check(graphSection(window).hidden,'Graph section shown on note');
 await window.ZoteroPane.selectItem(regular.id);await delay(150);checkLayout(window);check(!graphSection(window).hidden,'Graph section not restored for regular item');return {switches:2};
});
await test('a second native main window has independent graph controls and normal layout',async()=>{
 const other=window.openDialog('chrome://zotero/content/zoteroPane.xhtml','_blank','chrome,dialog=no,resizable');
 try{
  for(let i=0;i<150&&!other.document.getElementById('refnexus-show-hide-graph-view');i++)await delay(100);
  await other.ZoteroPane.selectItem(regular.id);await delay(200);checkLayout(other);check(graphSection(other).hidden,'Second window inherited graph visibility');
  graphButton(other).click();await delay(200);check(!graphSection(other).hidden,'Second-window native graph did not open');checkLayout(other);checkLayout(window);
  graphButton(other).click();await delay(150);check(graphSection(other).hidden,'Second-window graph did not hide');check(!graphSection(window).hidden,'Second window changed first window graph');return {windows:2,independent:true};
 }finally{other.close();await delay(200);}
});
await test('graph close restores the same native host geometry',async()=>{
 graphButton(window).click();await delay(150);check(graphSection(window).hidden,'Graph section did not hide');check(window.document.getElementById('graph-view').style.display==='none','Main graph remained visible');return checkLayout(window);
});
await test('PDF reader context hides the library-only graph section and retains its native rail',async()=>{
 const attachment=await Zotero.Attachments.importFromFile({file:cfg.fixtures+'\\single.pdf',parentItemID:regular.id});
 const reader=await Zotero.Reader.open(attachment.id);await delay(500);
 try{
  const context=window.document.getElementById('zotero-context-pane-inner');
  context.collapsed=false;await delay(200);
  const sections=[...context.querySelectorAll('item-pane-custom-section[data-pane$="-refnexus-graph"]')];
  check(sections.length>0,'Reader graph section not initialized');check(sections.every(section=>section.hidden),'Library graph section leaked into reader context');
  const rail=window.document.getElementById('zotero-context-pane-sidenav'),r=rail.getBoundingClientRect();
  check(r.width===37&&r.height>0,'Reader icon rail geometry changed');return {readerRailWidth:r.width,libraryGraphHidden:true};
 }finally{reader.close();window.Zotero_Tabs.select('zotero-pane');await delay(150);checkLayout(window);}
});
await test('disable and hot-upgrade recovery repair the legacy vertical mutation',async()=>{
 const addon=await AddonManager.getAddonByID('refnexus@polygon.org');
 for(let i=0;i<2;i++){
  await addon.disable();await delay(200);checkLayout(window);check(!window.document.getElementById('connected-papers-relatedsplit-after'),'Graph panel leaked after disable');
  window.document.getElementById('zotero-item-pane').setAttribute('orient','vertical');
  await addon.enable();for(let n=0;n<100&&!Zotero.ZoteroRefNexus?.views?.referenceTasks;n++)await delay(100);
  await window.ZoteroPane.selectItem(regular.id);await delay(300);checkLayout(window);
  for(const id of ['refnexus-references','refnexus-graph'])check(window.document.querySelectorAll('#zotero-item-details item-pane-custom-section[data-pane$="-'+id+'"]').length===1,'Missing or duplicate native section '+id);
 }
 return {cycles:2,legacyRecovered:true,geometry:checkLayout(window)};
});
try {
 const host=window.document.getElementById('zotero-item-pane'),r=host.getBoundingClientRect();
 const canvas=window.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=Math.ceil(r.width);canvas.height=Math.ceil(r.height);
 canvas.getContext('2d').drawWindow(window,r.x,r.y,canvas.width,canvas.height,'rgb(255,255,255)');
 const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
 const path=cfg.output.replace(/\.json$/,'.png');await IOUtils.write(path,new Uint8Array(await blob.arrayBuffer()));report.screenshot=path;
}catch(error){report.screenshotError=String(error);}
report.finished=new Date().toISOString();report.passed=report.tests.filter(t=>t.ok).length;report.failed=report.tests.filter(t=>!t.ok).length;await save();
