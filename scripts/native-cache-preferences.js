if (!/refflow-z10-release-/.test(Zotero.DataDirectory.dir)) throw Error('Isolated library required');
const views = Zotero.ZoteroRefFlow.views;
const store = views.storage;
await store.lock.promise;
if (store.filename !== PathUtils.join(Zotero.DataDirectory.dir, "refflow-reference-cache.json")) throw Error("Unexpected cache filename");
const prefix = "migration-probe";
const oldPath = PathUtils.join(Zotero.DataDirectory.dir, prefix + "-v2.json");
const newPath = PathUtils.join(Zotero.DataDirectory.dir, prefix + "-reference-cache.json");
const original = JSON.stringify({"1:PROBE":{References:["preserved"]}});
await window.IOUtils.writeUTF8(oldPath, original);
const migrated = new store.constructor(prefix);
await migrated.lock.promise;
if (await window.IOUtils.exists(oldPath) || await window.IOUtils.readUTF8(newPath) !== original ||
    migrated.get({key:"PROBE",libraryID:1},"References")[0] !== "preserved") throw Error("Existing cache migration failed");
await migrated.dispose();
await window.IOUtils.writeUTF8(oldPath, "{}");
const reopened = new store.constructor(prefix);
await reopened.lock.promise;
if (reopened.get({key:"PROBE",libraryID:1},"References")[0] !== "preserved" ||
    await window.IOUtils.readUTF8(oldPath) !== "{}") throw Error("Existing destination was overwritten");
await reopened.dispose();
const item = new Zotero.Item('journalArticle');
item.setField('title','Reference list cache audit');
item.setField('DOI','10.1234/cache-audit');
await item.saveTx();
await window.ZoteroPane.selectItem(item.id);
await Zotero.Promise.delay(300);
const body = window.document.querySelector('item-pane-custom-section[data-pane$="-refflow-references"] [data-type="body"]');
await views.referenceTasks.invalidate(body);
body.setAttribute('data-refflow-type','References');
body.setAttribute('source','API');
const http = Zotero.HTTP.request;
const online = views.onlineReferences;
const calls = [];
const stages = [];
try {
  Zotero.HTTP.request = async function(method,url,...args) {
    if (!url.startsWith('https://audit.invalid/')) return http.call(this,method,url,...args);
    calls.push(url);
    return {status:200,response:{title:'Cache fixture'}};
  };
  views.onlineReferences = async function(parent,task) {
    const result = await views.utils.API.requests.get('https://audit.invalid/A','json',{},task.signal);
    return {references:[{title:result.title,text:result.title,identifiers:{}}],source:'Fixture API'};
  };
  async function stage(name,action) {
    const count = calls.length;
    await action();
    stages.push({name,additionalHTTP:calls.length-count,visible:body.references?.length});
  }
  await stage('first open',()=>views.refreshReferences(body,true,false,false,item));
  await views.storage.flush();
  views.utils.API.requests.clearCache();
  body.references = [];
  await stage('repeat open after clearing HTTP memory',()=>views.refreshReferences(body,true,false,false,item));
  const disk = JSON.parse(await Zotero.File.getContentsAsync(views.storage.filename));
  const persisted = disk[item.libraryID+':'+item.key]['References-API'];
  await views.utils.API.requests.get('https://audit.invalid/B');
  await stage('manual force refresh A',()=>views.refreshReferences(body,false,false,false,item));
  await stage('reuse independent HTTP response B',()=>views.utils.API.requests.get('https://audit.invalid/B'));
  const expect = (condition,message)=>{if(!condition)throw Error(message);};
  expect(stages.map(stage=>stage.additionalHTTP).join(",")==="1,0,1,0","Scoped refresh or disk cache failed");
  const pref=Zotero.Utilities.Internal.openPreferences("refflow-preferences");
  try {
    const find=id=>pref.document.getElementById("refflow-"+id);
    for(let i=0;i<100 && find("referenceDays")?.value!=="30";i++) await Zotero.Promise.delay(50);
    const days=find("referenceDays"),master=find("cacheEnabled");
    expect(days?.value==="30" && find("neighborhoodDays").value==="30" && find("pdfDays").value==="30" && master?.checked,"Cache defaults not bound");
    expect(find("cache-path").value===views.storage.filename && find("cache-path").readOnly,"Unexpected cache file path");
    const capacity=find("cacheMaxMiB"),count=find("cacheMaxItems"),usage=find("cache-usage");
    expect(capacity.value==="8" && count.value==="250","Capacity defaults not bound");
    expect(usage.getAttribute("data-l10n-args").includes('"items"'),"Usage not populated");
    capacity.value="16";
    capacity.dispatchEvent(new pref.Event("change",{bubbles:true}));
    await Zotero.Promise.delay(50);
    expect(store.cacheUsage.maxBytes===16*1048576,"Capacity did not update live");
    count.value="10";
    count.dispatchEvent(new pref.Event("change",{bubbles:true}));
    for(let i=0;i<12;i++)await store.set({key:"CAPACITY"+i,libraryID:1},"setting",i);
    expect(store.cacheUsage.items===10 && store.metrics.evictions>0,"Count limit did not evict");
    const expiryItem={key:"EXPIRY",libraryID:1};
    await store.set(expiryItem,"setting","keep");
    await store.set(expiryItem,"References-PDF",{schema:4,savedAt:Date.now()-2*86400000,signature:"expiry",references:[],snapshot:{source:"PDF",status:"success"}});
    Zotero.Prefs.set("refflow.pdfDays",1);
    await Zotero.Promise.delay(50);
    expect(!store.get(expiryItem,"References-PDF") && store.get(expiryItem,"setting")==="keep","Retention change failed or removed unrelated data");
    find("cache-clean").click();
    await Zotero.Promise.delay(300);
    const formatted=await Zotero.File.getContentsAsync(store.filename);
    expect(formatted===JSON.stringify(JSON.parse(formatted),null,2)+"\n","Cache is not consistently formatted");
    expect(new TextEncoder().encode(formatted).length===store.cacheUsage.bytes,"Formatted bytes not reflected in usage");
    expect(store.metrics.expired>0,"Expired cleanup not counted");
    for(const name of ["cacheMaxMiB","cacheMaxItems","pdfDays"])Zotero.Prefs.clear("refflow."+name);
    await Zotero.Promise.delay(50);
    expect(capacity.value==="8" && count.value==="250" && store.cacheUsage.maxItems===250,"Capacity reset failed");
    const launch=Zotero.launchFile;
    let opened;
    try {
      Zotero.launchFile=path=>{opened=path;};
      find("cache-folder").click();
      expect(opened===Zotero.DataDirectory.dir,"Wrong containing folder");
    } finally {Zotero.launchFile=launch;}
    days.value="7";
    days.dispatchEvent(new pref.Event("change",{bubbles:true}));
    expect(Zotero.Prefs.get("refflow.referenceDays")===7,"Duration not saved");
    master.click();
    await Zotero.Promise.delay(100);
    expect(Zotero.Prefs.get("refflow.cacheEnabled")===false && days.disabled && capacity.disabled && count.disabled,"Master switch failed");
    await stage("disabled cache",()=>views.refreshReferences(body,true,false,false,item));
    expect(stages.at(-1).additionalHTTP===1,"Disabled cache reused prior response");
    Zotero.Prefs.clear("refflow.cacheEnabled");
    await Zotero.Promise.delay(50);
    expect(!days.disabled,"Reset did not restore dependent controls");
  } finally {pref.close();}
  await Zotero.File.putContentsAsync(cfg.output,JSON.stringify({version:Zotero.version,stages,calls,persistedRows:persisted.references.length,finished:true,failed:0},null,2));
} finally {
  views.onlineReferences = online;
  Zotero.HTTP.request = http;
}
