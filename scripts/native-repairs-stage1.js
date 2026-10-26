if(!/refflow-z10-release-/.test(Zotero.DataDirectory.dir))throw new Error('Isolated profile required');
const views=Zotero.ZoteroRefFlow.views,stamp=Date.now(),report={version:Zotero.version,scope:'real isolated SQLite; no external provider requests',tests:[]};
const check=(ok,text)=>{if(!ok)throw new Error(text);};
const save=()=>Zotero.File.putContentsAsync(cfg.output,JSON.stringify(report,null,2));
const test=async(name,run)=>{try{report.tests.push({name,ok:true,detail:await run()});}catch(error){report.tests.push({name,ok:false,error:String(error),stack:error.stack});}await save();};
const make=async(title,author,year)=>{const item=new Zotero.Item('journalArticle');item.setField('title',title);if(year)item.setField('date',year);if(author)item.setCreators([{creatorType:'author',lastName:author}]);await item.saveTx({skipSelect:true});return item;};
const ref=(title,author='Smith',year='2024')=>({title,text:title,authors:[author],year,identifiers:{},type:'journalArticle'});
// Synthetic no-DOI fixtures exercise ownership, not the user-facing DOI policy.
const opts={allowMetadataWithoutDOI:true,downloadOA:false,createSubCollection:false,createManifestNote:false};
await test('local search rejects conflicting metadata and distinguishes cached evidence',async()=>{
 const title='Native identity '+stamp,item=await make(title,'Smith','1995');views.utils.clearLibraryItemCache();
 check(!await views.utils.searchLibraryItem(ref(title,'Jones','2024'),item.libraryID),'Conflicting work matched');
 check((await views.utils.searchLibraryItem(ref(title,'Smith','1995'),item.libraryID))?.id===item.id,'Valid identity missed');return {conflictRejected:true,validMatched:true};
});
await test('same-title distinct author/year rows create two items',async()=>{
 const parent=await make('Batch identity '+stamp),title='Shared title distinct work '+stamp,rows=[ref(title,'Smith','1995'),ref(title,'Jones','2024')];
 const result=await views.importReferences(parent,rows,opts);check(result.importedCount===2&&rows[0]._item.id!==rows[1]._item.id,'Distinct identities collapsed');return {created:result.importedCount};
});
await test('cross-parent later reuse survives rollback of creator batch',async()=>{
 const a=await make('Cross parent A '+stamp),b=await make('Cross parent B '+stamp),title='Reused across parents '+stamp,rowsA=[ref(title)],rowsB=[ref(title)];
 const first=await views.importReferences(a,rowsA,opts),second=await views.importReferences(b,rowsB,opts);
 check(second.existingCount===1,'Second batch did not reuse');await views.rollbackReferences(a,first.batchId);
 const item=await Zotero.Items.getAsync(rowsB[0]._item.id);check(!item.deleted,'Reused item trashed');check(b.relatedItems.includes(item.key),'Later relation lost');check(!a.relatedItems.includes(item.key),'Old relation not removed');return {retained:true};
});
await test('same-parent repeated import leases relations until the final rollback',async()=>{
 const parent=await make('Same parent leases '+stamp),title='Same parent repeated reference '+stamp,a=[ref(title)],b=[ref(title)];
 const first=await views.importReferences(parent,a,opts),second=await views.importReferences(parent,b,opts);
 await views.rollbackReferences(parent,first.batchId);check(parent.relatedItems.includes(b[0]._item.key),'Shared relation removed early');
 await views.rollbackReferences(parent,second.batchId);check(!parent.relatedItems.includes(b[0]._item.key),'Last batch did not release relation');return {bothOrdersSafe:true};
});
await test('reverse rollback order removes only later claims then safely trashes original creation',async()=>{
 const parent=await make('Reverse order '+stamp),title='Reverse order reference '+stamp,a=[ref(title)],b=[ref(title)];
 const first=await views.importReferences(parent,a,opts),second=await views.importReferences(parent,b,opts);
 await views.rollbackReferences(parent,second.batchId);check(!a[0]._item.deleted&&parent.relatedItems.includes(a[0]._item.key),'Earlier active batch damaged');
 await views.rollbackReferences(parent,first.batchId);check(a[0]._item.deleted,'Exclusive untouched creation not removed');return {safe:true};
});
await test('user-edited imported metadata survives rollback',async()=>{
 const parent=await make('User edits '+stamp),rows=[ref('User editable import '+stamp)],batch=await views.importReferences(parent,rows,opts);
 rows[0]._item.setField('title','User changed title '+stamp);await rows[0]._item.saveTx();await views.rollbackReferences(parent,batch.batchId);
 check(!rows[0]._item.deleted,'User changes trashed');return {retained:true};
});
await test('untouched exclusive creation remains rollbackable and repeated rollback is harmless',async()=>{
 const parent=await make('Exclusive rollback '+stamp),rows=[ref('Exclusive reference '+stamp)],batch=await views.importReferences(parent,rows,opts);
 check(await views.rollbackReferences(parent,batch.batchId)===1,'Expected one exclusive item trashed');check(rows[0]._item.deleted,'Creation survived');check(await views.rollbackReferences(parent,batch.batchId)===0,'Repeated rollback mutated items');return {trashed:1,idempotent:true};
});
await test('shared collection membership transfers to the last active batch',async()=>{
 const parent=await make('Shared collection parent '+stamp),target=await make('Shared collection reference '+stamp,'Smith','2024');
 const col=new Zotero.Collection();col.libraryID=parent.libraryID;col.name='Shared import collection '+stamp;await col.saveTx();
 const options={...opts,collections:[col.id]},first=await views.importReferences(parent,[ref(String(target.getField('title')))],options),second=await views.importReferences(parent,[ref(String(target.getField('title')))],options);
 await views.rollbackReferences(parent,first.batchId);check(target.getCollections().includes(col.id),'Shared membership removed early');
 await views.rollbackReferences(parent,second.batchId);check(!target.getCollections().includes(col.id)&&!target.deleted,'Final membership not released or existing item removed');return {transferred:true};
});
await test('user-added collection protects an imported creation',async()=>{
 const parent=await make('User collection parent '+stamp),rows=[ref('User collection target '+stamp)],batch=await views.importReferences(parent,rows,opts);
 const col=new Zotero.Collection();col.libraryID=parent.libraryID;col.name='User collection '+stamp;await col.saveTx();rows[0]._item.addToCollection(col.id);await rows[0]._item.saveTx();
 await views.rollbackReferences(parent,batch.batchId);check(!rows[0]._item.deleted&&rows[0]._item.getCollections().includes(col.id),'User collection use destroyed');return {retained:true};
});
await test('user-added child notes protect an imported creation',async()=>{
 const parent=await make('User child parent '+stamp),rows=[ref('User child target '+stamp)],batch=await views.importReferences(parent,rows,opts);
 const note=new Zotero.Item('note');note.libraryID=parent.libraryID;note.parentID=rows[0]._item.id;note.setNote('<p>User research note</p>');await note.saveTx();
 await views.rollbackReferences(parent,batch.batchId);check(!rows[0]._item.deleted&&!note.deleted,'User child content destroyed');return {retained:true};
});
await test('legacy markers without edit baselines retain imported creations',async()=>{
 const parent=await make('Legacy safe rollback '+stamp),target=await make('Legacy user research '+stamp),id='ref_batch_legacy_'+stamp;
 target.setField('extra','import_batch: '+id);await target.saveTx();parent.setField('extra','ref_batch_parent: '+id);await parent.saveTx();
 check(await views.rollbackReferences(parent,id)===0&&!target.deleted,'Unverifiable legacy object removed');return {retained:true};
});
await test('a corrupt active journal prevents destructive reconciliation',async()=>{
 const parent=await make('Journal integrity A '+stamp),other=await make('Journal integrity B '+stamp),rows=[ref('Journal integrity target '+stamp)],batch=await views.importReferences(parent,rows,opts);
 other.setField('extra','refnexus_record_refnexus_batch_corrupt: {bad JSON');await other.saveTx();let rejected=false;
 try{await views.rollbackReferences(parent,batch.batchId);}catch{rejected=true;}
 check(rejected&&!rows[0]._item.deleted&&parent.relatedItems.includes(rows[0]._item.key),'Corrupt ownership failed open');other.setField('extra','');await other.saveTx();return {rejected:true,unchanged:true};
});
await test('an edited batch manifest note survives rollback',async()=>{
 const parent=await make('Edited manifest parent '+stamp),rows=[ref('Edited manifest target '+stamp)],batch=await views.importReferences(parent,rows,{...opts,createManifestNote:true});
 const note=await Zotero.Items.getAsync(parent.getNotes()[0]);note.setNote('<p>User-expanded research summary</p>');await note.saveTx();
 await views.rollbackReferences(parent,batch.batchId);check(!note.deleted&&note.getNote().includes('User-expanded'),'Edited manifest deleted');return {noteRetained:true};
});
await test('user annotations on a batch-downloaded PDF protect its parent and attachment',async()=>{
 const parent=await make('Annotated OA parent '+stamp),rows=[{...ref('Annotated OA target '+stamp),oaUrl:'https://controlled.test/paper.pdf'}],original=Zotero.Attachments.importFromURL;
 try{
   Zotero.Attachments.importFromURL=async options=>Zotero.Attachments.importFromFile({file:cfg.fixtures+'\\single.pdf',parentItemID:options.parentItemID});
   const batch=await views.importReferences(parent,rows,{...opts,downloadOA:true});check(batch.downloadCount===1,'PDF fixture not recorded');
   const attachment=await Zotero.Items.getAsync(rows[0]._item.getAttachments()[0]),annotation=new Zotero.Item('annotation');annotation.libraryID=parent.libraryID;annotation.parentID=attachment.id;
   annotation.annotationType='highlight';annotation.annotationText='User-highlighted evidence';annotation.annotationColor='#ffd400';annotation.annotationPageLabel='1';annotation.annotationSortIndex='00000|000000|00000';annotation.annotationPosition=JSON.stringify({pageIndex:0,rects:[[10,10,50,20]]});await annotation.saveTx();
   await views.rollbackReferences(parent,batch.batchId);check(!rows[0]._item.deleted&&!attachment.deleted&&!annotation.deleted,'Annotated research content removed');return {parentRetained:true,pdfRetained:true,annotationRetained:true};
 }finally{Zotero.Attachments.importFromURL=original;}
});
await test('editing batch-downloaded PDF metadata without annotations protects its parent',async()=>{
 const parent=await make('Edited OA metadata parent '+stamp),rows=[{...ref('Edited OA metadata target '+stamp),oaUrl:'https://controlled.test/edited.pdf'}],original=Zotero.Attachments.importFromURL;
 try{
   Zotero.Attachments.importFromURL=async options=>Zotero.Attachments.importFromFile({file:cfg.fixtures+'\\single.pdf',parentItemID:options.parentItemID});
   const batch=await views.importReferences(parent,rows,{...opts,downloadOA:true});check(batch.downloadCount===1,'PDF fixture not recorded');
   const attachment=await Zotero.Items.getAsync(rows[0]._item.getAttachments()[0]);attachment.setField('title','User-organized evidence PDF');await attachment.saveTx();
   check(!attachment.getAnnotations().length,'Expected unannotated attachment');await views.rollbackReferences(parent,batch.batchId);
   check(!rows[0]._item.deleted&&!attachment.deleted,'Edited attachment retained under a trashed parent');return {parentRetained:true,pdfRetained:true,annotations:0};
 }finally{Zotero.Attachments.importFromURL=original;}
});
report.finished=new Date().toISOString();report.passed=report.tests.filter(row=>row.ok).length;report.failed=report.tests.filter(row=>!row.ok).length;report.errors=Zotero.getErrors(true).map(String);await save();
