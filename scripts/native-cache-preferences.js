if (!/refflow-z10-release-/.test(Zotero.DataDirectory.dir)) throw Error('Isolated library required');
const views = Zotero.ZoteroRefFlow.views;
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
    for(let i=0;i<100 && find("referenceDays")?.value!=="1";i++) await Zotero.Promise.delay(50);
    const days=find("referenceDays"),master=find("cacheEnabled");
    expect(days?.value==="1" && master?.checked,"Cache defaults not bound");
    days.value="7";
    days.dispatchEvent(new pref.Event("change",{bubbles:true}));
    expect(Zotero.Prefs.get("refflow.referenceDays")===7,"Duration not saved");
    master.click();
    await Zotero.Promise.delay(100);
    expect(Zotero.Prefs.get("refflow.cacheEnabled")===false && days.disabled,"Master switch failed");
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
