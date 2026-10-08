// Run only with the previous production XPI in an isolated profile, after publishing.
if(!/refnexus-z10-release-/.test(Zotero.DataDirectory.dir))throw new Error('Isolated profile required');
const {AddonManager}=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
const report={version:Zotero.version,scope:'Native AddonManager automatic update; real GitHub update manifest and XPI',tests:[]};
const delay=ms=>Zotero.Promise.delay(ms),check=(ok,message)=>{if(!ok)throw new Error(message);};
const save=()=>Zotero.File.putContentsAsync(cfg.output,JSON.stringify(report,null,2));
const test=async(name,fn)=>{try{report.tests.push({name,ok:true,detail:await fn()});}catch(error){report.tests.push({name,ok:false,error:String(error),stack:error.stack});}await save();};
let addon,install;
const base='https://raw.githubusercontent.com/groele/Zotero-diy/main/RefNexus-Zotero10/';
await test('previous 10.3.3 is active with the same upgrade identity',async()=>{
 addon=await AddonManager.getAddonByID('refnexus@polygon.org');check(addon?.isActive&&addon.version==='10.3.3','Previous production addon not active');check(addon.updateURL===base+'update.json','Wrong previous update URL');return {version:addon.version,id:addon.id,updateURL:addon.updateURL};
});
await test('native updater discovers 11.0.0 from the user repository',async()=>{
 check(addon?.version==='10.3.3','Previous version unavailable');
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Update discovery exceeded 45 seconds')),45000);
  addon.findUpdates({onUpdateAvailable(_addon,available){install=available;},onUpdateFinished(_addon,status){clearTimeout(timer);if(!install)reject(new Error('No update offered; native status '+status));else resolve();}},AddonManager.UPDATE_WHEN_USER_REQUESTED);
 });
 check(install.version==='11.0.0','Wrong offered version: '+install.version);check(install.sourceURI.spec===base+'zotero-refnexus.xpi','Wrong offered package');
 return {version:install.version,source:install.sourceURI.spec};
});
await test('native updater downloads, verifies and installs the production package',async()=>{
 check(install,'No native install available');
 await new Promise((resolve,reject)=>{
  const listener={onInstallEnded(){finish();},onDownloadFailed(){finish(new Error('Download failed: '+install.error));},onInstallFailed(){finish(new Error('Install failed: '+install.error));},onDownloadCancelled(){finish(new Error('Download cancelled'));},onInstallCancelled(){finish(new Error('Install cancelled'));}};
  const timer=setTimeout(()=>finish(new Error('Installation exceeded 60 seconds')),60000);
  function finish(error){clearTimeout(timer);install.removeListener(listener);error?reject(error):resolve();}
  install.addListener(listener);Promise.resolve(install.install()).catch(finish);
 });
 const current=await AddonManager.getAddonByID('refnexus@polygon.org');check(current?.version==='11.0.0'&&current.isActive,'New addon not active');
 for(let i=0;i<300&&!Zotero.ZoteroRefNexus?.views?.referenceTasks;i++)await delay(100);
 check(Zotero.ZoteroRefNexus?.views?.referenceTasks,'Updated plugin did not start');
 check(current.updateURL===base+'update.json','Updated plugin changed update authority');
 return {version:current.version,active:current.isActive,id:current.id};
});
await test('updated native reference pane remains registered once per context',async()=>{
 const current=await AddonManager.getAddonByID('refnexus@polygon.org');check(current.version==='11.0.0','Upgrade did not complete');
 const item=new Zotero.Item('journalArticle');item.setField('title','Actual native updater smoke test');await item.saveTx();await window.ZoteroPane.selectItem(item.id);await delay(300);
 const panes=[...window.document.querySelectorAll('item-pane-custom-section[data-pane$="-refnexus-references"]')];check(panes.length,'Updated pane missing');const contexts=new Set();for(const pane of panes){const context=pane.closest('item-details')||pane.parentElement;check(!contexts.has(context),'Duplicate updated pane');contexts.add(context);}return {panes:panes.length,uniqueContexts:true};
});
report.finished=new Date().toISOString();report.passed=report.tests.filter(t=>t.ok).length;report.failed=report.tests.filter(t=>!t.ok).length;await save();
