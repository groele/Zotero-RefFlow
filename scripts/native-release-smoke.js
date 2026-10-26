/* Upgrade a sideloaded previous XPI in a fresh test profile, then restart it. */
if(!/refflow-z10-release-/.test(Zotero.DataDirectory.dir))throw new Error('Isolated profile required');
const {AddonManager}=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
const expected=JSON.parse(await Zotero.File.getContentsAsync(cfg.workspace+'\\package.json')).version;
const saved=Zotero.Prefs.get('refflow.releaseSmoke'),seed=saved?JSON.parse(saved):undefined;
if(seed)cfg.output=cfg.output.replace(/\.json$/,'-restart.json');
const report={version:Zotero.version,phase:seed?'restart':'upgrade',at:new Date().toISOString(),tests:[]};
const check=(ok,text)=>{if(!ok)throw new Error(text);},delay=ms=>Zotero.Promise.delay(ms);
const wait=async(fn)=>{for(let i=0;i<300;i++){if(await fn())return;await delay(50);}throw new Error('Release smoke condition did not settle');};
const test=async(name,run)=>{try{report.tests.push({name,ok:true,detail:await run()});}catch(error){report.tests.push({name,ok:false,error:String(error),stack:error.stack});}await Zotero.File.putContentsAsync(cfg.output,JSON.stringify(report,null,2));};
const preferences=async()=>{
 const owner=Zotero.ZoteroRefFlow,pref=Zotero.Utilities.Internal.openPreferences('refflow-preferences');
 try{await wait(()=>pref.document.querySelector('.refflow-pref-footer')&&owner.data.prefs?.window===pref);
  const xml=await Zotero.File.getContentsAsync(cfg.workspace+'\\build\\addon\\chrome\\content\\preferences.xhtml'),stamp=xml.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/)?.[0],root=pref.document.getElementById('zotero-prefpane-refflow'),footer=root.querySelector('.refflow-pref-footer');
  check(stamp&&footer.textContent.includes(stamp)&&!footer.textContent.includes('__build'),'Footer is not bound to build time');
  check(root.querySelector('.refflow-pref-version').textContent.includes(expected),'Preferences version mismatch');
  check(footer.querySelector(`a[href="https://github.com/groele/Zotero-RefFlow/releases/download/v${expected}/zotero-refflow.xpi"]`),'Wrong installer link');return {version:expected,buildTime:stamp};
 }finally{pref.close();await delay(100);}
};
let fixture;
if(!seed){
 await test('previous stable XPI is active before native installation',async()=>{const addon=await AddonManager.getAddonByID('refflow@groele.github.io');check(addon?.isActive&&addon.version!==expected,'Previous stable version not active');return {previous:addon.version,next:expected};});
 fixture=new Zotero.Item('journalArticle');fixture.setField('title','Release upgrade preserved fixture');fixture.setField('extra','User data retained during isolated upgrade');await fixture.saveTx({skipSelect:true});Zotero.Prefs.set('refflow.autoRefresh',false);Zotero.Prefs.set('refflow.sortBy','Original');
 await test('native AddonManager installs the release XPI and reloads its runtime',async()=>{
  const before=Zotero.ZoteroRefFlow,file=Zotero.File.pathToFile(cfg.workspace+'\\build\\online-verification.xpi'),install=await AddonManager.getInstallForFile(file);
  check(install,'No native installer');
  await new Promise((resolve,reject)=>{let timer;const finish=(error)=>{window.clearTimeout(timer);install.removeListener(listener);error?reject(error):resolve();};const listener={onInstallEnded(){finish();},onInstallFailed(){finish(new Error('Native installation failed'));},onDownloadFailed(){finish(new Error('Native installer download failed'));}};install.addListener(listener);timer=window.setTimeout(()=>finish(new Error('Native installation timed out')),30000);try{Promise.resolve(install.install()).catch(finish);}catch(error){finish(error);}});
  await wait(async()=>{const addon=await AddonManager.getAddonByID('refflow@groele.github.io');return addon?.isActive&&addon.version===expected&&Zotero.ZoteroRefFlow!==before&&Zotero.ZoteroRefFlow?.views?.referenceTasks;});return {installed:expected,reloaded:true};
 });
}else{
 await test('release XPI remains active after an actual process restart',async()=>{const addon=await AddonManager.getAddonByID('refflow@groele.github.io');check(addon?.isActive&&addon.version===expected&&Zotero.ZoteroRefFlow?.views?.referenceTasks,'Restarted release not active');return {version:addon.version,active:true};});
 fixture=await Zotero.Items.getAsync(seed.itemID);
}
await test('library item and preferences survive the upgrade or restart',async()=>{check(fixture&&!fixture.deleted&&fixture.getField('title')==='Release upgrade preserved fixture'&&fixture.getField('extra')==='User data retained during isolated upgrade','Fixture changed');check(Zotero.Prefs.get('refflow.sortBy')==='Original'&&Zotero.Prefs.get('refflow.autoRefresh')===false,'Preferences changed');return {itemID:fixture.id,key:fixture.key,preserved:true};});
await test('native preferences expose the release version, real build time and installer link',preferences);
if(seed)await test('restarted native card uses the aligned SVG action',async()=>{
 await window.ZoteroPane.selectItem(fixture.id);let body;await wait(()=>{body=window.document.querySelector('item-pane-custom-section[data-pane$="-refflow-references"] [data-type="body"]');return body?._cards&&body.getAttribute('data-refflow-item-id')===String(fixture.id);});body.closest('item-pane-custom-section').querySelector('collapsible-section').open=true;
 const refs=[{title:'Restarted card alignment',text:'Restarted citation',authors:[],identifiers:{}}];body.references=refs;await body._cards.render(refs,()=>true);const row=body.querySelector('.reference-item'),title=row.querySelector('.reference-title'),action=row.querySelector('.reference-action'),r=title.getBoundingClientRect(),b=action.getBoundingClientRect();check(action.querySelector('svg')&&action.dataset.actionState==='add'&&Math.abs(b.top+b.height/2-r.top-parseFloat(window.getComputedStyle(title).lineHeight)/2)<1,'Restarted icon layout failed');return {svg:true,aligned:true};
});
report.finished=new Date().toISOString();report.passed=report.tests.filter(row=>row.ok).length;report.failed=report.tests.filter(row=>!row.ok).length;report.hostErrors=Zotero.getErrors(true).map(String);
if(!seed&&!report.failed)Zotero.Prefs.set('refflow.releaseSmoke',JSON.stringify({version:expected,itemID:fixture.id}));
await Zotero.File.putContentsAsync(cfg.output,JSON.stringify(report,null,2));
