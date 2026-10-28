if(!/refflow-z10-release-/.test(Zotero.DataDirectory.dir))throw new Error('Isolated profile required');
const views=Zotero.ZoteroRefFlow.views,report={host:Zotero.version,scope:'Windows Zotero 10.0.6 isolated profile; controlled source responses',tests:[]};
const check=(value,message)=>{if(!value)throw new Error(message);};
const save=()=>Zotero.File.putContentsAsync(cfg.output,JSON.stringify(report,null,2));
const test=async(name,run)=>{try{report.tests.push({name,ok:true,detail:await run()});}catch(error){report.tests.push({name,ok:false,error:String(error),stack:error.stack});}await save();};
const wait=async(fn)=>{for(let i=0;i<250;i++){if(fn())return;await Zotero.Promise.delay(20);}throw new Error('Native sidebar did not settle');};
const win=Zotero.getMainWindow();Zotero.Prefs.set('refflow.autoRefresh',false);Zotero.Prefs.set('refflow.isShowTip',false);win.Zotero_Tabs.select('zotero-pane');
const item=new Zotero.Item('journalArticle');item.setField('title','RefFlow source details native acceptance');item.setField('DOI','10.1234/source-details');await item.saveTx({skipSelect:true});await win.ZoteroPane.selectItem(item.id);
let body;await wait(()=>{body=win.document.querySelector('item-pane-custom-section[data-pane$="-refflow-references"] [data-type="body"]');return body?._cards&&Number(body.getAttribute('data-refflow-item-id'))===item.id;});body.closest('item-pane-custom-section').querySelector('collapsible-section').open=true;
const api=views.utils.API,originalGetList=api.getReferenceList,originalPublisher=api.publisherReferences.getReferences,originalSource=body.getAttribute('source');
try {
 body.setAttribute('source','Web');
 api.publisherReferences.getReferences=async()=>undefined;
 api.getReferenceList=async()=>({references:[{title:'Reference 1',text:'Reference 1',authors:[],identifiers:{DOI:'10.1234/first'},number:1}],source:'Crossref',partial:false});
 await views.refreshReferences(body,false,false,false,item);
 await test('Selected import requires an explicit selection',async()=>{
   const cards=body._cards;cards.selected.clear();let failure='';
   try{await views.runSettingsAction('import-selected');}catch(error){failure=String(error);}
   check(failure.includes('选择')||failure.toLowerCase().includes('select'),'No selection did not explain the requirement');
   return {blocked:true};
 });
 await test('Fetch completion and item switching keep cancellation scoped to the importing item',async()=>{
   const originalSearch=Zotero.Translate.Search,originalOnline=api.getReferenceList;let started=false;
   Zotero.Translate.Search=class {setIdentifier(v){this.doi=v.DOI;}async getTranslators(){return ['controlled'];}setTranslator(){}async translate(){started=true;return new Promise(()=>{});}};
   try {
     const ref={title:'Pending import',text:'Pending import',authors:[],identifiers:{DOI:'10.1234/held-workflow'}};
     const job=views.importReferences(item,[ref],{owner:body,downloadOA:false,createSubCollection:false,createManifestNote:false,budgetMs:8000,translatorTimeoutMs:7000});
     await wait(()=>started);const cancel=body.querySelector('#refflow-cancel');check(!cancel.hidden,'Cancel missing while import runs');
     api.getReferenceList=async()=>({references:[{title:'Fresh',text:'Fresh',authors:[],identifiers:{},number:1}],source:'Crossref',partial:false});
     await views.refreshReferences(body,false,false,false,item);check(!cancel.hidden,'Fetch completion hid the running import cancel');
     const other=new Zotero.Item('journalArticle');other.setField('title','Other workflow item');await other.saveTx({skipSelect:true});await win.ZoteroPane.selectItem(other.id);await wait(()=>Number(body.getAttribute('data-refflow-item-id'))===other.id);check(cancel.hidden,'Old item cancel appeared for a new item');
     await win.ZoteroPane.selectItem(item.id);await wait(()=>Number(body.getAttribute('data-refflow-item-id'))===item.id);check(!cancel.hidden,'Returning to the item lost the running import cancel');
     cancel.click();const result=await Promise.race([job,Zotero.Promise.delay(12000).then(()=>{throw new Error("Cancellation did not settle")})]);check(result.cancelled,'Owned import did not cancel');await wait(()=>cancel.hidden);
     return {fetchCompleted:true,switchSafe:true,cancelled:result.cancelled};
   }finally{Zotero.Translate.Search=originalSearch;api.getReferenceList=originalOnline;}
 });
}finally{api.getReferenceList=originalGetList;api.publisherReferences.getReferences=originalPublisher;body.setAttribute('source',originalSource||'PDF');}
report.finished=new Date().toISOString();report.passed=report.tests.filter(row=>row.ok).length;report.failed=report.tests.filter(row=>!row.ok).length;await save();
