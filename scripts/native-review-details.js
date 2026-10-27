/* Detail regression: independent Zotero profile, real SQLite/UI and local PDF. */
if(!/refflow-z10-release-/.test(Zotero.DataDirectory.dir))throw new Error('Isolated profile required');
const views=Zotero.ZoteroRefFlow.views,delay=ms=>Zotero.Promise.delay(ms),report={version:Zotero.version,at:new Date().toISOString(),scope:'Isolated native SQLite/UI; controlled DOI metadata and download faults; real local HTTP PDF download',tests:[]};
const check=(ok,message)=>{if(!ok)throw new Error(message);};
const save=()=>Zotero.File.putContentsAsync(cfg.output,JSON.stringify(report,null,2));
const test=async(name,run)=>{try{report.tests.push({name,ok:true,detail:await run()});}catch(error){report.tests.push({name,ok:false,error:String(error),stack:error.stack});}await save();};
const wait=async(fn)=>{for(let i=0;i<200;i++){if(fn())return;await delay(20);}throw new Error('Native detail condition timed out');};
const screenshot=async(name)=>{const pane=window.document.getElementById('zotero-item-pane'),body=pane.querySelector('item-pane-custom-section[data-pane$="-refflow-references"] [data-type="body"]');window.restore();body.closest('item-pane-custom-section').querySelector('collapsible-section').open=true;body.scrollIntoView({block:'nearest'});await delay(80);const r=pane.getBoundingClientRect(),canvas=window.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=Math.ceil(r.width);canvas.height=Math.ceil(r.height);canvas.getContext('2d').drawWindow(window,r.x,r.y,canvas.width,canvas.height,'rgb(255,255,255)');const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png')),path=cfg.output.replace(/\.json$/,`-${name}.png`);await IOUtils.write(path,new Uint8Array(await blob.arrayBuffer()));return path;};
const make=async(title)=>{const item=new Zotero.Item('journalArticle');item.setField('title',title);await item.saveTx({skipSelect:true});return item;};
const ref=(name)=>({title:'Reference '+name,authors:[],identifiers:{DOI:'10.1234/detail-'+name},oaUrl:'http://127.0.0.1:18796/pdf'});
const opts={downloadOA:false,createSubCollection:false,createManifestNote:false,collections:[]};
const select=async(parent)=>{window.Zotero_Tabs.select('zotero-pane');await window.ZoteroPane.selectItem(parent.id);let body;await wait(()=>{body=window.document.querySelector('item-pane-custom-section[data-pane$="-refflow-references"] [data-type="body"]');return body?._cards&&body.getAttribute('data-refflow-item-id')===String(parent.id);});return body;};
const menuImport=async(parent,rows)=>{
 const body=await select(parent);body._cards.clear();body.references=rows;await body._cards.render(rows,()=>true);
 Zotero.Prefs.set('refflow.downloadOA',true);body._cards.menu();const menu=window.document.querySelector('menupopup[data-refflow-menu="references"]');check(menu,'Missing reference menu');menu.querySelectorAll('menuitem')[5].dispatchEvent(new window.Event('command'));
 await wait(()=>body.querySelector('#reference-num').textContent.includes('已添加：1'));menu.remove();return body.querySelector('#reference-num').textContent;
};
const original=Zotero.Translate.Search,originalDownload=Zotero.Attachments.importFromURL;
Zotero.Prefs.set('refflow.autoRefresh',false);
Zotero.Translate.Search=class{setIdentifier(value){this.doi=value.DOI;}async getTranslators(){return ['controlled'];}setTranslator(){}async translate(options){check(options.libraryID===false&&!options.saveAttachments,'Unmanaged native writes');return [{itemType:'journalArticle',DOI:this.doi,title:'Native '+this.doi}];}};
try{
 await test('an empty native attachment result is counted as a failed OA attempt',async()=>{
  const parent=await make('Empty OA result'),rows=[ref('empty')];Zotero.Attachments.importFromURL=async()=>undefined;
  try{const result=await views.importReferences(parent,rows,{...opts,downloadOA:true});check(result.importedCount===1&&result.failedCount===0&&result.downloadCount===0&&result.downloadFailedCount===1,'Empty download was reported as success');check(!rows[0]._item.getAttachments().length,'Unexpected attachment');return {imported:1,pdfFailed:1};}
  finally{Zotero.Attachments.importFromURL=originalDownload;}
 });
 await test('native batch status reports a PDF failure while preserving imported metadata',async()=>{
  const parent=await make('OA failure status'),rows=[ref('failure')];Zotero.Attachments.importFromURL=async()=>{throw new Error('Controlled PDF download error');};
  try{const message=await menuImport(parent,rows);check(message.includes('PDF')&&message.includes('下载失败：1'),'PDF failure was hidden: '+message);check(rows[0]._item&&!rows[0]._item.deleted,'Imported metadata was lost');return {message,screenshot:await screenshot('pdf-failure')};}
  finally{Zotero.Attachments.importFromURL=originalDownload;}
 });
 await test('a real local HTTP PDF is attached and its successful count is visible',async()=>{
  const parent=await make('Actual PDF download status'),rows=[ref('success')],message=await menuImport(parent,rows),ids=rows[0]._item.getAttachments();
  check(ids.length===1,'Expected one real PDF attachment');const file=await Zotero.Items.getAsync(ids[0]);check(file.attachmentContentType==='application/pdf'&&await file.fileExists(),'Downloaded PDF is missing');check(message.includes('PDF')&&message.includes('已下载：1'),'Successful PDF count hidden: '+message);
  const image=await screenshot('pdf-success'),batch=(await IOUtils.readJSON(PathUtils.join(Zotero.DataDirectory.dir,'refflow-batch-journal-v1.json'))).entries.filter(row=>row.record.parentID===parent.id).pop()?.batchID;check(batch,'Missing batch');await views.rollbackReferences(parent,batch);check(file.deleted&&rows[0]._item.deleted,'Owned unedited PDF/item did not roll back');return {downloaded:1,message,rollback:true,screenshot:image};
 });
 for(const empty of ['', ' '])await test('a '+(empty?'whitespace':'zero-length')+' other active journal blocks destructive rollback',async()=>{
  const parent=await make('Ownership owner '+empty.length),other=await make('Damaged journal owner '+empty.length),rows=[ref('journal-'+empty.length)],batch=await views.importReferences(parent,rows,opts),prefix='refnexus_record_refnexus_batch_damaged_'+other.id+': ';
  other.setField('extra','refnexus_batch_parent: refnexus_batch_damaged_'+other.id+'\n'+prefix+empty);await other.saveTx({skipSelect:true});const before=String(parent.getField('extra'));let rejected=false;
  try{await views.rollbackReferences(parent,batch.batchId);}catch{rejected=true;}
  try{check(rejected&&!rows[0]._item.deleted&&String(parent.getField('extra'))===before,'Malformed peer journal did not protect the item and original journal');return {rejected:true,itemPreserved:true};}
  finally{other.setField('extra','');await other.saveTx({skipSelect:true});}
 });
 await test('an empty own journal is rejected without clearing recovery markers',async()=>{
  const parent=await make('Empty own journal'),rows=[ref('own-journal')],batch=await views.importReferences(parent,rows,opts),prefix='refnexus_record_'+batch.batchId+':';
  parent.setField('extra','refnexus_batch_parent: '+batch.batchId+'\n'+prefix);await parent.saveTx({skipSelect:true});const before=String(parent.getField('extra'));let rejected=false;
  try{await views.rollbackReferences(parent,batch.batchId);}catch{rejected=true;}
  try{check(rejected&&!rows[0]._item.deleted&&String(parent.getField('extra'))===before,'Empty modern journal was treated as legacy and its recovery marker removed');return {rejected:true,recoveryMarkersPreserved:true};}
  finally{parent.setField('extra','');await parent.saveTx({skipSelect:true});}
 });
 await test('a nonempty malformed peer journal still blocks rollback',async()=>{
  const parent=await make('Malformed peer control'),other=await make('Invalid JSON owner'),rows=[ref('bad-json')],batch=await views.importReferences(parent,rows,opts);
  other.setField('extra','refnexus_batch_parent: refnexus_batch_bad_json\nrefnexus_record_refnexus_batch_bad_json: {broken');await other.saveTx({skipSelect:true});let rejected=false;
  try{await views.rollbackReferences(parent,batch.batchId);}catch{rejected=true;}
  try{check(rejected&&!rows[0]._item.deleted,'Nonempty malformed JSON was not rejected');return {rejected:true};}
  finally{other.setField('extra','');await other.saveTx({skipSelect:true});}
 });
 await test('disabled OA download leaves a successful import without PDF status noise',async()=>{
  let calls=0;Zotero.Attachments.importFromURL=async()=>{calls++;};const parent=await make('OA disabled'),rows=[ref('disabled')];
  try{const result=await views.importReferences(parent,rows,opts);check(result.importedCount===1&&calls===0&&result.downloadFailedCount===0,'Disabled download still attempted a request');return {imported:1,calls};}
  finally{Zotero.Attachments.importFromURL=originalDownload;}
 });
}finally{Zotero.Translate.Search=original;Zotero.Attachments.importFromURL=originalDownload;}
report.finished=new Date().toISOString();report.passed=report.tests.filter(row=>row.ok).length;report.failed=report.tests.filter(row=>!row.ok).length;report.hostErrors=Zotero.getErrors(true).map(String);await save();
