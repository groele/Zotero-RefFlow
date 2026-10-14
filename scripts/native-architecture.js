if (!/refflow-z10-release-/.test(Zotero.DataDirectory.dir)) throw new Error('Isolated profile required');
const {AddonManager} = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
const report = {version: Zotero.version, at: new Date().toISOString(), tempDir:Zotero.getTempDirectory().path, scope: 'native lifecycle, DOM, SQLite; controlled provider responses', tests: []};
const save = () => Zotero.File.putContentsAsync(cfg.output, JSON.stringify(report, null, 2));
const check = (value, message) => {if (!value) throw new Error(message);};
const delay = ms => Zotero.Promise.delay(ms);
const test = async (name, run) => {try {report.tests.push({name, ok:true, detail:await run()});} catch(error) {report.tests.push({name,ok:false,error:String(error),stack:error.stack});} await save();};
report.startupErrors = Zotero.getErrors(true);
let views = Zotero.ZoteroRefFlow?.views;
await test('production cold startup', async () => {check(views, 'Plugin unavailable: '+JSON.stringify(report.startupErrors));return {alive:Zotero.ZoteroRefFlow.data.alive};});
if (views) {
  Zotero.Prefs.set('refflow.autoRefresh',false);
  const parent = new Zotero.Item('journalArticle');parent.setField('title','Architecture full and page cache fixture');await parent.saveTx();
  await Zotero.Attachments.importFromFile({file:cfg.fixtures+'\\single.pdf',parentItemID:parent.id});
  const select = async () => {window.Zotero_Tabs.select('zotero-pane');await window.ZoteroPane.selectItem(parent.id);await delay(150);const body=window.document.querySelector('item-pane-custom-section[data-pane$="-refflow-references"] [data-type="body"]');check(body,'Pane missing');return body;};
  await test('page extraction cannot read or overwrite the Auto full-document cache', async () => {
    const body=await select(),original=views.smartReferences,originalPDF=views.utils.PDF.getReferences;
    body.setAttribute('source','Auto');body.setAttribute('data-refflow-type','References');let calls=0;
    views.smartReferences=async(_item,_reader,_task,_pdf,page)=>{calls++;return {references:[{number:1,title:page?'Page fixture':'Full fixture',text:page?'Page fixture':'Full fixture',identifiers:{}}],source:'PDF'};};
    views.utils.PDF.getReferences=async(_attachment,page)=>{calls++;return [{title:page?'Page fixture':'Full fixture',text:page?'Page fixture':'Full fixture',identifiers:{}}];};
    try {
      await views.refreshReferences(body,false,false,false,parent);const before=JSON.stringify(await views.storage.getAsync(parent,'References-Auto'));
      await views.refreshReferences(body,true,true,false,parent);check(calls===2,'Page extraction reused full cache');check(body.references[0].title==='Page fixture','Page result missing');
      check(JSON.stringify(await views.storage.getAsync(parent,'References-Auto'))===before,'Page result overwrote full cache');
      await views.refreshReferences(body,true,false,false,parent);check(body.references[0].title==='Full fixture','Full result replaced by page cache');return {calls,fullCachePreserved:true};
    }finally{views.smartReferences=original;views.utils.PDF.getReferences=originalPDF;}
  });
  await test('graph import relates every origin atomically and rollback restores all links', async () => {
    const second=new Zotero.Item('journalArticle');second.setField('title','Architecture second origin');await second.saveTx();
    const ref={title:'Architecture imported graph node',text:'Architecture imported graph node',authors:['Fixture Author'],identifiers:{}};
    const result=await views.importReferences(parent,[ref],{relatedParents:[second],downloadOA:false,createSubCollection:false,createManifestNote:false});
    check(result.importedCount===1&&ref._item,'Graph node was not saved');
    check(parent.relatedItems.includes(ref._item.key)&&second.relatedItems.includes(ref._item.key),'Not all origins linked');
    check(ref._item.relatedItems.includes(parent.key)&&ref._item.relatedItems.includes(second.key),'Reverse links missing');
    const id=ref._item.id;await views.rollbackReferences(parent,result.batchId);
    check(!parent.relatedItems.includes(ref._item.key)&&!second.relatedItems.includes(ref._item.key),'Rollback left origin links');
    check(Zotero.Items.get(id).deleted,'Rollback did not trash created node');return {origins:2,created:1,rollback:true};
  });
  await test('native graph HTTP polling renders the official public test graph fixture', async () => {
    const fixture=JSON.parse(await Zotero.File.getContentsAsync(cfg.workspace+'\\docs\\evidence\\architecture-2026-10-12\\connectedpapers-live-fixture.json'));
    const original=Zotero.HTTP.request,previousKey=Zotero.Prefs.get('ConnectedPapers.accessToken');let polls=0;
    Zotero.Prefs.set('ConnectedPapers.accessToken','TEST_TOKEN');
    Zotero.HTTP.request=async(method,url,options)=>{
      if(url.includes('api.semanticscholar.org/graph/v1/paper/DOI:'))return {status:200,response:{paperId:fixture.graph_json.start_id,title:'Native graph origin',externalIds:{DOI:'10.1234/native-graph-origin'}}};
      if(url.includes('/papers-api/graph/')){check(options.headers['X-Api-Key']==='TEST_TOKEN','Graph key header missing');polls++;return {status:200,response:polls===1?{status:'QUEUED'}:fixture};}
      return original.call(Zotero.HTTP,method,url,options);
    };
    try {
      parent.setField('DOI','10.1234/native-graph-origin');await parent.saveTx();await select();
      const graphButton=window.document.getElementById('refflow-show-hide-graph-view');graphButton.click();await delay(150);
      const add=window.document.getElementById('add-origin');check(add,'Graph origin action unavailable');add.click();
      for(let i=0;i<100&&!window.document.querySelector('.origin-items .item');i++)await delay(50);
      check(window.document.querySelector('.origin-items .item'),'Graph origin was not added');window.document.getElementById('build-graph').click();
      const expected=Object.keys(fixture.graph_json.nodes).length;
      for(let i=0;i<300&&window.document.querySelectorAll('.normal-items .item').length!==expected;i++)await delay(50);
      check(polls===2,'Graph status polling was cached or repeated');check(window.document.querySelectorAll('.normal-items .item').length===expected,'Graph node list was not rendered');
      const app=window.document.querySelector('#graph-view iframe').contentWindow.app;check(Object.keys(app.graphdata.nodes).length===expected,'Graph data was not committed to the native embedded viewer');
      return {nodes:expected,polls,nativeEmbeddedViewer:true,provider:'controlled responses from official TEST_TOKEN fixture; live fetch recorded separately'};
    }finally{Zotero.HTTP.request=original;Zotero.Prefs.set('ConnectedPapers.accessToken',previousKey||'');const graph=window.document.getElementById('graph-view');if(graph&&graph.style.display!=='none')window.document.getElementById('refflow-show-hide-graph-view').click();}
  });
  await test('closing a secondary window cancels its pane jobs', async () => {
    const other=window.openDialog('chrome://zotero/content/zoteroPane.xhtml','','chrome,dialog=no,resizable');
    try {
      for(let i=0;i<150&&(!other.ZoteroPane?.itemsView||!other.document.getElementById('refflow-style'));i++)await delay(50);
      await Promise.all([Zotero.ZoteroRefFlow.hooks.onMainWindowLoad(other),Zotero.ZoteroRefFlow.hooks.onMainWindowLoad(other)]);
      await other.ZoteroPane.selectItem(parent.id);await delay(150);
      const body=other.document.querySelector('item-pane-custom-section[data-pane$="-refflow-references"] [data-type="body"]');check(body,'Secondary pane missing');
      const tip=views.showTipUI({left:20,right:100,top:50,bottom:70,width:80,height:20}, {title:'Secondary window hover fixture',text:'Secondary window hover fixture',identifiers:{},authors:[]}, 'left', undefined, true, other);
      await delay(50);check(other.document.querySelector('.refflow-tip-container')?.textContent.includes('Secondary window hover fixture'),'Hover opened outside the owning window');tip.clear();
      let signal;const pending=views.referenceTasks.run(body,'window-close-test',async ctx=>{signal=ctx.signal;await new Promise(resolve=>ctx.signal.addEventListener('abort',resolve,{once:true}));});
      await delay(10);other.close();await pending;check(signal.aborted,'Closing window kept its task alive');check(views.referenceTasks.size===0,'Pane retained');return {cancelled:true,styleCount:1};
    }finally{if(!other.closed)other.close();}
  });
  await test('disable disposes the old cache and rejects late writes', async () => {
    const old=views,addon=await AddonManager.getAddonByID('refflow@groele.github.io');await old.storage.set(parent,'lifecycle-fixture','kept');
    await addon.disable();for(let i=0;i<150&&Zotero.ZoteroRefFlow;i++)await delay(50);check(!Zotero.ZoteroRefFlow,'Addon remained active');await old.storage.set(parent,'lifecycle-fixture','late');
    check(old.storage.get(parent,'lifecycle-fixture')==='kept','Disposed cache accepted a late write');
    let ran=false;await old.referenceTasks.run({},'late',async()=>{ran=true;});check(!ran,'Disposed scheduler restarted');
    await addon.enable();for(let i=0;i<150&&!Zotero.ZoteroRefFlow?.views;i++)await delay(50);views=Zotero.ZoteroRefFlow?.views;check(views&&views!==old,'Re-enable did not create fresh services');return {lateWritesRejected:true,reEnabled:true};
  });
}
report.errors = Zotero.getErrors(true);report.finished=new Date().toISOString();report.passed=report.tests.filter(t=>t.ok).length;report.failed=report.tests.filter(t=>!t.ok).length;await save();
