if(!/refflow-z10-release-/.test(Zotero.DataDirectory.dir))throw new Error('Isolated profile required');
const views=Zotero.ZoteroRefFlow.views,report={host:Zotero.version,scope:'Windows Zotero 10.0.6 isolated profile; controlled source responses',tests:[]};
const check=(value,message)=>{if(!value)throw new Error(message);};
const save=()=>Zotero.File.putContentsAsync(cfg.output,JSON.stringify(report,null,2));
const test=async(name,run)=>{try{report.tests.push({name,ok:true,detail:await run()});}catch(error){report.tests.push({name,ok:false,error:String(error),stack:error.stack});}await save();};
const wait=async(fn,label="Native sidebar did not settle")=>{for(let i=0;i<250;i++){if(fn())return;await Zotero.Promise.delay(20);}throw new Error(label);};
const win=Zotero.getMainWindow();Zotero.Prefs.set('refflow.autoRefresh',false);Zotero.Prefs.set('refflow.isShowTip',false);win.Zotero_Tabs.select('zotero-pane');
const item=new Zotero.Item('journalArticle');item.setField('title','RefFlow source details native acceptance');item.setField('DOI','10.1234/source-details');await item.saveTx({skipSelect:true});await win.ZoteroPane.selectItem(item.id);
let body;await wait(()=>{body=win.document.querySelector('item-pane-custom-section[data-pane$="-refflow-references"] [data-type="body"]');return body?._cards&&Number(body.getAttribute('data-refflow-item-id'))===item.id;});body.closest('item-pane-custom-section').querySelector('collapsible-section').open=true;
const api=views.utils.API,originalGetList=api.getReferenceList,originalPublisher=api.publisherReferences.getReferences,originalSource=body.getAttribute('source');
try{
 await test('Keyboard-discoverable details explain selected source, counts, partial status, and attempts',async()=>{
  body.setAttribute('source','Web');
  api.publisherReferences.getReferences=async()=>{throw new Error('HTTP 503 https://publisher.example/private?token=do-not-show Authorization: Bearer secret-value');};
  api.getReferenceList=async()=>({references:[1,2].map(n=>({title:`Reference ${n}`,text:`Reference ${n}`,authors:[],identifiers:{DOI:`10.1234/settings-${n}`},number:n})),source:'Crossref',expected:4,partial:true});
  await views.refreshReferences(body,false,false,false,item);
  const details=body.querySelector('#refflow-source-details'),summary=details?.querySelector('summary');
  check(details&&!details.hidden&&summary,'Accessible source disclosure is missing');
  check(summary.tabIndex>=0,'Summary cannot receive keyboard focus');
  check(details.textContent.includes('Crossref')&&details.textContent.includes('2')&&details.textContent.includes('4'),'Source/count explanation is incomplete');
  check(details.textContent.includes('partial')||details.textContent.includes('部分'),'Partial list was described as complete');
  check(details.textContent.includes('Publisher / JATS')&&details.textContent.includes('Online:'),'Provider attempts are missing');
  check(!/publisher\.example|do-not-show|secret-value/.test(details.textContent),'Diagnostic leaked a URL or credential');
  summary.focus();check(win.document.activeElement===summary,'Source disclosure is not keyboard reachable');summary.click();check(details.open,'Native disclosure did not open');
  return {selected:body.getAttribute('data-refflow-result-source'),attempts:details.querySelectorAll('li').length,open:details.open};
 });
 await test('Source visibility and quick action switches render in settings',async()=>{
  const pref=Zotero.Utilities.Internal.openPreferences('refflow-preferences');
  await wait(()=>pref.document.getElementById('zotero-prefpane-refflow'),'Settings root did not render');
  const root=pref.document.getElementById('zotero-prefpane-refflow');
  const group=root.querySelector('#refflow-actions-title').closest('details');group.open=true;
  const toggle=root.querySelector('#refflow-show-source-details'),details=body.querySelector('#refflow-source-details');
  check(toggle && details && !details.hidden,'Setting or source details missing');
  await wait(()=>Boolean(toggle.checked)===Boolean(Zotero.Prefs.get('refflow.showSourceDetails')),'Preference binding did not initialize');
  toggle.click();await wait(()=>Zotero.Prefs.get('refflow.showSourceDetails')===false,'Hide preference did not change');await Zotero.Promise.delay(100);
  check(details.hidden,'Disabling source details did not hide it');
  toggle.click();await wait(()=>Zotero.Prefs.get('refflow.showSourceDetails')===true,'Show preference did not change');await Zotero.Promise.delay(100);
  check(!details.hidden,'Enabling source details did not restore it');
  const old=views.utils.copyText;let copied='';views.utils.copyText=(value)=>{copied=value;};
  try {await views.runSettingsAction('copy-text');check(copied.includes('Reference 1'),'Reference action did not copy');} finally {views.utils.copyText=old;}
  check(root.querySelectorAll('[data-refflow-quick-action]').length===7,'Quick actions missing');
  pref.close();return {toggle:true,copy:true,actions:7};
 });
 await test('Reference import and undo write only to the isolated Zotero library',async()=>{
  const original=Zotero.Translate.Search;let calls=0;
  Zotero.Translate.Search=class {setIdentifier(value){this.doi=value.DOI;}async getTranslators(){return ['controlled'];}setTranslator(){}async translate(){calls++;return [{itemType:'journalArticle',title:'Settings '+this.doi,DOI:this.doi}];}};
  const pref=Zotero.Utilities.Internal.openPreferences('refflow-preferences');
  try {
    await wait(()=>pref.document.getElementById('zotero-prefpane-refflow'),'Settings root did not render');
    const root=pref.document.getElementById('zotero-prefpane-refflow');root.querySelector('#refflow-actions-title').closest('details').open=true;
    await views.runSettingsAction('import-all');check(calls===2,'Expected two translator lookups');
    const search=new Zotero.Search();search.libraryID=item.libraryID;search.addCondition('DOI','is','10.1234/settings-1');const ids=await search.search();check(ids.length===1,'Import did not create the expected item');
    const imported=Zotero.Items.get(ids[0]);check(!imported.deleted,'Imported item was already deleted');
    const rollbackStatus=await views.runSettingsAction('rollback');
    await imported.reload();check(imported.deleted,'Undo did not move the imported item to trash');
    return {imported:ids.length,lookupCalls:calls,undo:true,status:rollbackStatus};
  }finally{Zotero.Translate.Search=original;pref.close();}
 });
 await test('Unavailable providers explain failures while marking the visible earlier list as retained',async()=>{
  api.publisherReferences.getReferences=async()=>{throw new Error('Controlled publisher outage https://publisher.example/secret?token=private');};
  api.getReferenceList=async()=>{throw new Error('Controlled online outage Authorization: Bearer secret-value');};
  try{await views.refreshReferences(body,false,false,false,item);}catch{}
  const details=body.querySelector('#refflow-source-details');
  check(details?.dataset.latestStatus==='unavailable','Latest unavailable attempt was not exposed');
  check(details.dataset.retained==='true'&&details.dataset.count==='2','Visible earlier list was not identified as retained');
  check(details.textContent.includes('Publisher / JATS')&&details.textContent.includes('Online:'),'Provider failures were hidden');
  check(!/publisher\.example|private|secret-value/.test(details.textContent),'Unavailable provider diagnostics leaked private data');
  return {status:details.dataset.status,retained:details.dataset.retained,count:details.dataset.count};
 });
 await test('Source disclosure has no horizontal overflow with light/dark media preferences at narrow and regular widths',async()=>{
  const host=win.document.getElementById('zotero-item-pane'),details=body.querySelector('#refflow-source-details');
  check(host&&details,'Native item pane or source disclosure is missing');
  const scheme=Services.prefs.getIntPref('layout.css.prefers-color-scheme.content-override',2),dark=Services.prefs.prefHasUserValue('ui.systemUsesDarkTheme')?Services.prefs.getIntPref('ui.systemUsesDarkTheme'):undefined;
  const originalWidth=host.style.width;
  try{
   details.open=true;
   for(const theme of ['light','dark'])for(const width of [280,480]){
    Services.prefs.setIntPref('ui.systemUsesDarkTheme',theme==='dark'?1:0);Services.prefs.setIntPref('layout.css.prefers-color-scheme.content-override',theme==='dark'?0:1);host.style.width=width+'px';
    await wait(()=>win.matchMedia('(prefers-color-scheme: dark)').matches===(theme==='dark'));
    check(details.scrollWidth<=details.clientWidth+1,`Source details overflow in ${theme} ${width}px layout`);
    const rect=host.getBoundingClientRect(),canvas=win.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=Math.ceil(rect.width);canvas.height=Math.ceil(rect.height);canvas.getContext('2d').drawWindow(win,rect.x,rect.y,canvas.width,canvas.height,'rgb(255,255,255)');
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));await IOUtils.write(cfg.output.replace(/\.json$/,`-media-${theme}-${width}.png`),new Uint8Array(await blob.arrayBuffer()));
   }
  }finally{host.style.width=originalWidth;Services.prefs.setIntPref('layout.css.prefers-color-scheme.content-override',scheme);if(dark===undefined)Services.prefs.clearUserPref('ui.systemUsesDarkTheme');else Services.prefs.setIntPref('ui.systemUsesDarkTheme',dark);}
  return {mediaPreferences:['light','dark'],widths:[280,480],screenshots:true};
 });
 await test('Refreshing details preserves keyboard focus and expanded state',async()=>{
  const details=body.querySelector('#refflow-source-details'),summary=details.querySelector('summary');
  details.open=true;summary.focus();
  api.getReferenceList=async()=>({references:[1,2].map(n=>({title:`Reference ${n}`,text:`Reference ${n}`,authors:[],identifiers:{DOI:`10.1234/settings-${n}`},number:n})),source:'Crossref',expected:4,partial:true});
  await views.refreshReferences(body,false,false,false,item);
  check(details.querySelector('summary')===summary,'Refresh replaced the keyboard target');
  check(win.document.activeElement===summary,'Refresh dropped keyboard focus');
  check(details.open,'Refresh collapsed the disclosure');
  return {sameNode:true,focused:true,open:details.open};
 });
 await test('Switching item clears the prior source details',async()=>{
  const other=new Zotero.Item('journalArticle');other.setField('title','Different item');await other.saveTx({skipSelect:true});await win.ZoteroPane.selectItem(other.id);
  await wait(()=>Number(body.getAttribute('data-refflow-item-id'))===other.id);
  check(body.querySelector('#refflow-source-details')?.hidden,'Old source details leaked across Zotero item selection');
  return {itemID:other.id,cleared:true};
 });
}finally{api.getReferenceList=originalGetList;api.publisherReferences.getReferences=originalPublisher;body.setAttribute('source',originalSource||'PDF');}
report.finished=new Date().toISOString();report.passed=report.tests.filter(row=>row.ok).length;report.failed=report.tests.filter(row=>!row.ok).length;await save();
