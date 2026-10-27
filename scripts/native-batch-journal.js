/* Isolated, real-file acceptance for local rollback journals. */
if(!/refflow-z10-release-/.test(Zotero.DataDirectory.dir))throw new Error('Isolated profile required');
const views=Zotero.ZoteroRefFlow.views,io=window.IOUtils,path=PathUtils.join(Zotero.DataDirectory.dir,'refflow-batch-journal-v1.json');
const marker=PathUtils.join(Zotero.DataDirectory.dir,'batch-journal-acceptance.json');
const report={host:Zotero.version,tests:[]};
const check=(v,m)=>{if(!v)throw new Error(m);};
const save=()=>Zotero.File.putContentsAsync(cfg.output,JSON.stringify(report,null,2));
const test=async(name,run)=>{try{report.tests.push({name,ok:true,detail:await run()});}catch(error){report.tests.push({name,ok:false,error:String(error),stack:error.stack});}await save();};
const make=async(title,extra='')=>{const item=new Zotero.Item('journalArticle');item.setField('title',title);item.setField('extra',extra);await item.saveTx({skipSelect:true});return item;};
const ref=doi=>({title:'Controlled reference',authors:[],identifiers:{DOI:doi}});
const opts={downloadOA:false,createSubCollection:false,createManifestNote:false,collections:[]};
const original=Zotero.Translate.Search;
Zotero.Prefs.set('refflow.autoRefresh',false);Zotero.Prefs.set('refflow.isShowTip',false);
if(await io.exists(marker)){
 const fixture=await io.readJSON(marker),parent=await Zotero.Items.getAsync(fixture.parent),child=await Zotero.Items.getAsync(fixture.child);
 await test('restart reads durable journal and leaves Extra clean',async()=>{const data=await io.readJSON(path);check(data.entries.some(row=>row.batchID===fixture.batch),'Batch lost after restart');check(parent.getField('extra')===fixture.extra,'Extra changed after restart');});
 await test('restart rollback uses local evidence without Extra markers',async()=>{const count=await views.rollbackReferences(parent,fixture.batch);check(count===1&&child.deleted,'Restart rollback did not trash owned item');check(parent.getField('extra')===fixture.extra,'Rollback changed user Extra');});
}else{
 Zotero.Translate.Search=class{setIdentifier(v){this.doi=v.DOI;}async getTranslators(){return ['fixture'];}setTranslator(){}async translate(){return [{itemType:'journalArticle',DOI:this.doi,title:'Resolved '+this.doi}];}};
 let seed;
 const extra='JCR分区: Q1\n影响因子: 7.8\nSCI: 是\nESI: 材料科学\nManual user note';
 const importOne=async(label)=>{const parent=await make(label,extra),rows=[ref('10.1234/'+label)];const batch=await views.importReferences(parent,rows,opts);check(batch.importedCount===1,JSON.stringify(batch));return {parent,child:rows[0]._item,batch:batch.batchId,extra};};
 await test('new import stores all batch metadata in local JSON and no Extra markers',async()=>{seed=await importOne('journal-new');const data=await io.readJSON(path);check(!data.pending&&data.entries.some(row=>row.batchID===seed.batch),'No durable batch');check(seed.parent.getField('extra')===extra,'Parent Extra polluted');check(seed.child.getField('extra')==='','Child Extra polluted');return {path,entries:data.entries.length};});
 await test('native pane migrates legacy JSON while preserving journal metrics and user text',async()=>{
  const f=await importOne('journal-legacy'),data=await io.readJSON(path),entry=data.entries.find(row=>row.batchID===f.batch);data.entries=data.entries.filter(row=>row!==entry);await io.writeJSON(path,data,{tmpPath:path+'.tmp'});
  f.parent.setField('extra',extra+'\nrefnexus_batch_parent: '+f.batch+'\nrefnexus_record_'+f.batch+': '+JSON.stringify(entry.record));await f.parent.saveTx({skipSelect:true});f.child.setField('extra','import_batch: '+f.batch);await f.child.saveTx({skipSelect:true});
  window.Zotero_Tabs.select('zotero-pane');await window.ZoteroPane.selectItem(f.parent.id);await Zotero.Promise.delay(300);
  const body=window.document.querySelector('item-pane-custom-section[data-pane$="-refflow-references"] [data-type="body"]');check(body?._cards,'No native reference cards');await body._cards.render([],()=>true);
  check(f.parent.getField('extra')===extra,'Legacy migration lost metrics/user text or kept internal lines');check(f.child.getField('extra')==='','Child marker remains');check((await io.readJSON(path)).entries.some(row=>row.batchID===f.batch),'Legacy record not archived');
  check(await views.rollbackReferences(f.parent,f.batch)===1,'Migrated batch cannot be undone');return {preservedExtra:extra};
 });
 await test('shared item remains protected after rolling back its creating batch',async()=>{
  const f=await importOne('journal-shared'),second=await make('Second owner'),rows=[ref('10.1234/journal-shared')],batch=await views.importReferences(second,rows,opts);check(batch.existingCount===1,'Shared item not reused');
  await views.rollbackReferences(f.parent,f.batch);check(!f.child.deleted&&f.child.relatedItems.includes(second.key),'Shared item or relation lost');await views.rollbackReferences(second,batch.batchId);check(!f.child.deleted,'Reused item incorrectly deleted');
 });
 await test('later user edits protect the created item',async()=>{const f=await importOne('journal-edited');f.child.setField('title','User edit');await f.child.saveTx({skipSelect:true});check(await views.rollbackReferences(f.parent,f.batch)===0&&!f.child.deleted,'User edit was deleted');});
 await test('migration disk failure retains original Extra and rolls back native changes',async()=>{
  const f=await importOne('journal-failure'),data=await io.readJSON(path),entry=data.entries.find(row=>row.batchID===f.batch);data.entries=data.entries.filter(row=>row!==entry);await io.writeJSON(path,data,{tmpPath:path+'.tmp'});
  const originalExtra=extra+'\nrefnexus_batch_parent: '+f.batch+'\nrefnexus_record_'+f.batch+': '+JSON.stringify(entry.record);f.parent.setField('extra',originalExtra);await f.parent.saveTx({skipSelect:true});f.child.setField('extra','import_batch: '+f.batch);await f.child.saveTx({skipSelect:true});
  let rejected=false;await io.makeDirectory(path+'.tmp');
  try{try{await views.importReferences(f.parent,[ref('10.1234/fault-trigger')],opts);}catch{rejected=true;}}finally{await io.remove(path+'.tmp');}
  check(rejected,'Write failure was hidden');check(f.parent.getField('extra')===originalExtra,'Original Extra was lost');check(f.child.getField('extra')==='import_batch: '+f.batch&&!f.child.deleted,'Child mutation escaped rollback');
  await views.rollbackReferences(f.parent,f.batch);
 });
 await test('corrupt or pending local journal refuses writes and preserves exact file bytes',async()=>{
  const before=await io.readUTF8(path);try{for(const value of ['{broken JSON',JSON.stringify({version:1,pending:true,entries:[]})]){await io.writeUTF8(path,value);let failed=false;try{await views.importReferences(seed.parent,[ref('10.1234/must-not-save')],opts);}catch{failed=true;}check(failed,'Unsafe file accepted');check(await io.readUTF8(path)===value,'Unsafe file replaced');}}finally{await io.writeUTF8(path,before);}
 });
 await io.writeJSON(marker,{parent:seed.parent.id,child:seed.child.id,batch:seed.batch,extra});
 Zotero.Translate.Search=original;
}
report.finished=new Date().toISOString();report.passed=report.tests.filter(row=>row.ok).length;report.failed=report.tests.filter(row=>!row.ok).length;await save();
