if(!/refflow-z10-release-/.test(Zotero.DataDirectory.dir))throw new Error('Isolated profile required');
const views=Zotero.ZoteroRefFlow.views,delay=ms=>Zotero.Promise.delay(ms);
const report={version:Zotero.version,at:new Date().toISOString(),scope:'Real isolated SQLite, controlled DOI metadata, no external provider requests',tests:[]};
const check=(ok,message)=>{if(!ok)throw new Error(message);};
const save=()=>Zotero.File.putContentsAsync(cfg.output,JSON.stringify(report,null,2));
const test=async(name,run)=>{try{report.tests.push({name,ok:true,detail:await run()});}catch(error){report.tests.push({name,ok:false,error:String(error),stack:error.stack});}await save();};
const wait=async(fn)=>{for(let i=0;i<150;i++){if(fn())return;await delay(20);}throw new Error('Native condition timed out');};
const screenshot=async(body,name)=>{window.restore();body.closest('item-pane-custom-section').querySelector('collapsible-section').open=true;body.scrollIntoView({block:'nearest'});await delay(80);const r=window.document.getElementById('zotero-item-pane').getBoundingClientRect(),canvas=window.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=Math.ceil(r.width);canvas.height=Math.ceil(r.height);canvas.getContext('2d').drawWindow(window,r.x,r.y,canvas.width,canvas.height,'rgb(255,255,255)');const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png')),path=cfg.output.replace(/\.json$/,`-${name}.png`);await IOUtils.write(path,new Uint8Array(await blob.arrayBuffer()));return path;};
const make=async(title,doi)=>{const item=new Zotero.Item('journalArticle');item.setField('title',title);if(doi)item.setField('DOI',doi);await item.saveTx({skipSelect:true});return item;};
const collection=async(name)=>{const item=new Zotero.Collection();item.libraryID=Zotero.Libraries.userLibraryID;item.name=name;await item.saveTx();return item;};
const select=async(parent)=>{await window.ZoteroPane.selectItem(parent.id);let body;await wait(()=>{body=window.document.querySelector('item-pane-custom-section[data-pane$="-refflow-references"] [data-type="body"]');return body?._cards&&!body._cards.disposed&&body.getAttribute('data-refflow-item-id')===String(parent.id);});return body;};
const ref=(doi)=>({title:'Reference '+doi,authors:[],identifiers:{DOI:doi}});
const opts={downloadOA:false,createSubCollection:false,createManifestNote:false,collections:[]};
const native=Zotero.Translate.Search;
Zotero.Translate.Search=class{setIdentifier(value){this.doi=value.DOI;}async getTranslators(){return ['controlled'];}setTranslator(){}async translate(options){check(options.libraryID===false&&!options.saveAttachments,'Unmanaged write');return [{itemType:'journalArticle',DOI:this.doi,title:'Native '+this.doi,creators:[]}];}};
Zotero.Prefs.set('refflow.autoRefresh',false);
try{
 for(const change of ['rename','move'])await test('rollback preserves a user-'+change+'d empty batch collection',async()=>{
  const parent=await make('Collection protection '+change),rows=[ref('10.1234/protect-'+change)];
  const batch=await views.importReferences(parent,rows,{...opts,createSubCollection:true});check(batch.importedCount===1,'Import failed');const col=batch.subCollection;
  if(change==='rename')col.name='User-organized research';else col.parentID=(await collection('User hierarchy')).id;await col.saveTx();
  rows[0]._item.removeFromCollection(col.id);await rows[0]._item.saveTx({skipSelect:true});
  await views.rollbackReferences(parent,batch.batchId);const found=await Zotero.Collections.getAsync(col.id);check(found,'User-edited collection was erased');return {collectionPreserved:true};
 });
 await test('rollback preserves an imported item whose original collection was removed by the user',async()=>{
  const parent=await make('Removed membership protection'),col=await collection('Initial target'),rows=[ref('10.1234/protect-removed-membership')];
  const batch=await views.importReferences(parent,rows,{...opts,collections:[col.id]});const item=rows[0]._item;item.removeFromCollection(col.id);await item.saveTx({skipSelect:true});
  await views.rollbackReferences(parent,batch.batchId);check(!item.deleted,'User-organized item was trashed');return {itemPreserved:true};
 });
 await test('rollback preserves an imported item whose original relation was removed by the user',async()=>{
  const parent=await make('Removed relation protection'),rows=[ref('10.1234/protect-removed-relation')];const batch=await views.importReferences(parent,rows,opts),item=rows[0]._item;
  parent.removeRelatedItem(item);item.removeRelatedItem(parent);await parent.saveTx({skipSelect:true});await item.saveTx({skipSelect:true});
  await views.rollbackReferences(parent,batch.batchId);check(!item.deleted,'User-edited relation state lost its item');return {itemPreserved:true};
 });
 await test('unchanged exclusive items and their unedited empty batch collection remain undoable',async()=>{
  const parent=await make('Untouched cleanup'),rows=[ref('10.1234/protect-untouched')];const batch=await views.importReferences(parent,rows,{...opts,createSubCollection:true});
  await views.rollbackReferences(parent,batch.batchId);check(rows[0]._item.deleted,'Untouched creation was retained');check(!await Zotero.Collections.getAsync(batch.subCollection.id),'Untouched empty collection was retained');return {itemTrashed:true,collectionErased:true};
 });
 await test('a pre-change journal without a collection baseline conservatively preserves the collection',async()=>{
  const parent=await make('Old collection journal'),rows=[ref('10.1234/protect-legacy-col')],batch=await views.importReferences(parent,rows,{...opts,createSubCollection:true});
  const prefix='refnexus_record_'+batch.batchId+': ';parent.setField('extra',String(parent.getField('extra')).split('\n').map(line=>{if(!line.startsWith(prefix))return line;const value=JSON.parse(line.slice(prefix.length));delete value.collectionState;return prefix+JSON.stringify(value);}).join('\n'));await parent.saveTx({skipSelect:true});
  rows[0]._item.removeFromCollection(batch.subCollection.id);await rows[0]._item.saveTx({skipSelect:true});
  await views.rollbackReferences(parent,batch.batchId);check(await Zotero.Collections.getAsync(batch.subCollection.id),'Unverifiable historical collection was erased');return {legacyCollectionPreserved:true};
 });
 await test('an edit queued before rollback transaction admission is rechecked before deletion',async()=>{
  const parent=await make('Transaction admission protection'),rows=[ref('10.1234/protect-queued-edit')],batch=await views.importReferences(parent,rows,opts),item=rows[0]._item;
  const original=Zotero.DB.executeTransaction;let injected=false;
  Zotero.DB.executeTransaction=async function(fn,...args){if(!injected){injected=true;item.setField('title','User edit before rollback admission');await original.call(this,()=>item.save({skipSelect:true}));}return original.call(this,fn,...args);};
  try{await views.rollbackReferences(parent,batch.batchId);check(!item.deleted,'Late user edit was deleted');return {injected,itemPreserved:true};}finally{Zotero.DB.executeTransaction=original;}
 });
 await test('secondary arXiv identity cannot override an explicit conflicting DOI in native local matching',async()=>{
  const other=await make('Related preprint with a different DOI','10.1234/protect-wrong-doi');other.setField('url','https://arxiv.org/abs/2401.12345');await other.saveTx({skipSelect:true});
  const wanted={title:other.getField('title'),authors:[],identifiers:{DOI:'10.1234/protect-correct-doi',arXiv:'2401.12345'}};
  const found=await views.utils.searchLibraryItem(wanted,other.libraryID,true);check(!found,'Conflicting DOI was reused');return {conflictRejected:true};
 });
 await test('malformed subrecord is rejected before any native relationship or item write',async()=>{
  const parent=await make('Malformed journal protection'),rows=[ref('10.1234/protect-malformed')],batch=await views.importReferences(parent,rows,opts),item=rows[0]._item,originalExtra=parent.getField('extra');
  const prefix='refnexus_record_'+batch.batchId+': ';parent.setField('extra',String(originalExtra).split('\n').map(line=>{if(!line.startsWith(prefix))return line;const data=JSON.parse(line.slice(prefix.length));data.uses=[{id:item.id,parents:null,collections:[]}];return prefix+JSON.stringify(data);}).join('\n'));await parent.saveTx({skipSelect:true});const corrupt=parent.getField('extra');
  try{let failed=false;try{await views.rollbackReferences(parent,batch.batchId);}catch{failed=true;}check(failed&&!item.deleted&&parent.relatedItems.includes(item.key)&&parent.getField('extra')===corrupt,'Corrupt journal changed native data');return {rejected:true,unchanged:true};}
  finally{parent.setField('extra',originalExtra);await parent.saveTx({skipSelect:true});}
 });
 await test('native rollback write failure restores live objects and keeps the journal retryable',async()=>{
  const parent=await make('Rollback failure recovery'),rows=[ref('10.1234/protect-rollback-failure')],batch=await views.importReferences(parent,rows,opts),item=rows[0]._item,originalExtra=parent.getField('extra');
  const originalSave=Zotero.Item.prototype.save;let injected=false,rejected=false;
  Zotero.Item.prototype.save=function(...args){if(this.id===item.id&&!injected){injected=true;throw new Error('Controlled rollback save failure');}return originalSave.apply(this,args);};
  try{await views.rollbackReferences(parent,batch.batchId);}catch{rejected=true;}finally{Zotero.Item.prototype.save=originalSave;}
  check(rejected&&injected&&!item.deleted&&parent.getField('extra')===originalExtra&&parent.relatedItems.includes(item.key)&&item.relatedItems.includes(parent.key),'Failed transaction leaked mutable object state');
  await views.rollbackReferences(parent,batch.batchId);check(item.deleted,'Recovered journal could not be retried');return {restored:true,retried:true};
 });
 await test('legacy marker cleanup preserves user Extra lines with the same suffix and late edits',async()=>{
  const parent=await make('Legacy Extra protection'),id='ref_batch_extra_'+Date.now();parent.setField('extra',`ref_batch_parent: ${id}\nUser research note: ${id}`);await parent.saveTx({skipSelect:true});
  const original=Zotero.Items.getAsync;let injected=false;
  Zotero.Items.getAsync=async function(...args){if(!injected){injected=true;parent.setField('extra',String(parent.getField('extra'))+'\nLate user Extra edit');await parent.saveTx({skipSelect:true});}return original.apply(this,args);};
  try{await views.rollbackReferences(parent,id);const text=String(parent.getField('extra'));check(text.includes('User research note: '+id)&&text.includes('Late user Extra edit')&&!text.includes('ref_batch_parent:'),'Legacy cleanup discarded user Extra');return {userLinesPreserved:true,lateEditPreserved:true};}finally{Zotero.Items.getAsync=original;}
 });
 await test('cancelling one native window leaves the other window import active for the same parent',async()=>{
  const parent=await make('Window cancellation ownership'),other=window.openDialog('chrome://zotero/content/zoteroPane.xhtml','','chrome,dialog=no,resizable');const original=Zotero.Translate.Search;let release;
  try{
   await wait(()=>other.ZoteroPane?.itemsView&&other.ZoteroPane?.collectionsView?.itemTreeView);await Zotero.ZoteroRefFlow.hooks.onMainWindowLoad(other);
   await window.ZoteroPane.selectItem(parent.id);await other.ZoteroPane.selectItem(parent.id);await delay(150);
   const selector='item-pane-custom-section[data-pane$="-refflow-references"] [data-type="body"]',one=window.document.querySelector(selector),two=other.document.querySelector(selector);check(one&&two,'Window panes unavailable');
   Zotero.Translate.Search=class{setIdentifier(value){this.doi=value.DOI;}async getTranslators(){return ['controlled'];}setTranslator(){}async translate(){return new Promise(resolve=>release=()=>resolve([{DOI:this.doi,title:'Native window metadata'}]));}};
   const a=[ref('10.1234/protect-window-one')],b=[ref('10.1234/protect-window-two')];
   const first=views.importReferences(parent,a,{...opts,owner:one});await wait(()=>release);const second=views.importReferences(parent,b,{...opts,owner:two});
   two.querySelector('#refflow-cancel').click();release();const [x,y]=await Promise.all([first,second]);check(x.importedCount===1&&!x.cancelled&&y.cancelled&&!b[0]._item,'Cancellation affected the other owner');return {firstCreated:1,secondCancelled:true};
  }finally{Zotero.Translate.Search=original;other.close();await delay(100);}
 });
 await test('identical DOI requests in two windows retain independent cancellation ownership',async()=>{
  const parent=await make('Identical window import ownership'),other=window.openDialog('chrome://zotero/content/zoteroPane.xhtml','','chrome,dialog=no,resizable'),original=Zotero.Translate.Search;let release;
  try{await wait(()=>other.ZoteroPane?.itemsView&&other.ZoteroPane?.collectionsView?.itemTreeView);await Zotero.ZoteroRefFlow.hooks.onMainWindowLoad(other);await window.ZoteroPane.selectItem(parent.id);await other.ZoteroPane.selectItem(parent.id);await delay(150);
   const selector='item-pane-custom-section[data-pane$="-refflow-references"] [data-type="body"]',one=window.document.querySelector(selector),two=other.document.querySelector(selector);
   Zotero.Translate.Search=class{setIdentifier(value){this.doi=value.DOI;}async getTranslators(){return ['controlled'];}setTranslator(){}async translate(){return new Promise(resolve=>release=()=>resolve([{DOI:this.doi,title:'Native identical window metadata'}]));}};
   const a=[ref('10.1234/protect-identical-windows')],b=[ref('10.1234/protect-identical-windows')],first=views.importReferences(parent,a,{...opts,owner:one});await wait(()=>release);const second=views.importReferences(parent,b,{...opts,owner:two});two.querySelector('#refflow-cancel').click();release();const [x,y]=await Promise.all([first,second]);check(x.importedCount===1&&y.cancelled&&!b[0]._item&&x.batchId!==y.batchId,'One window inherited the other result');return {independent:true};
  }finally{Zotero.Translate.Search=original;other.close();await delay(100);}
 });
 await test('closing an importing window cancels its pending lookup and ignores late metadata',async()=>{
  const parent=await make('Closing import owner'),other=window.openDialog('chrome://zotero/content/zoteroPane.xhtml','','chrome,dialog=no,resizable'),original=Zotero.Translate.Search;let release;
  try{await wait(()=>other.ZoteroPane?.itemsView&&other.ZoteroPane?.collectionsView?.itemTreeView);await Zotero.ZoteroRefFlow.hooks.onMainWindowLoad(other);await other.ZoteroPane.selectItem(parent.id);await delay(150);const pane=other.document.querySelector('item-pane-custom-section[data-pane$="-refflow-references"] [data-type="body"]');
   Zotero.Translate.Search=class{setIdentifier(value){this.doi=value.DOI;}async getTranslators(){return ['controlled'];}setTranslator(){}async translate(){return new Promise(resolve=>release=()=>resolve([{DOI:this.doi,title:'Late window metadata'}]));}};
   const rows=[ref('10.1234/protect-closed-window')],job=views.importReferences(parent,rows,{...opts,owner:pane});await wait(()=>release);other.close();let settled=false,result;job.then(value=>{result=value;settled=true;});await wait(()=>settled);check(result.cancelled&&!rows[0]._item,'Closed owner kept running');release();await delay(70);check(!rows[0]._item,'Closed window wrote late metadata');return {cancelled:true,lateIgnored:true};
  }finally{Zotero.Translate.Search=original;if(!other.closed)other.close();await delay(100);}
 });
 await test('native rollback menu updates local cards and status without an online refresh',async()=>{
  const parent=await make('Rollback menu local status'),rows=[ref('10.1234/protect-rollback-menu')],batch=await views.importReferences(parent,rows,opts),item=rows[0]._item,body=await select(parent);body.references=rows;await body._cards.render(rows,()=>true);
  const original=views.refreshReferences;let refreshes=0;views.refreshReferences=async()=>{refreshes++;};
  try{body._cards.menu();const popup=window.document.querySelector('menupopup[data-refflow-menu=references]'),command=[...popup.children].find(node=>/撤回|rollback|ripristin/i.test(node.getAttribute('label')||''));check(command,'Rollback command absent');command.dispatchEvent(new window.Event('command'));popup.hidePopup();
   try{await wait(()=>item.deleted&&/撤回|rollback|ripristin/i.test(body.querySelector('#reference-num').textContent));}catch(error){throw new Error('Success summary missing '+JSON.stringify({deleted:item.deleted,text:body.querySelector('#reference-num')?.textContent,connected:body.isConnected,parent:parent.id,bodyParent:body.getAttribute('data-refflow-item-id'),selected:window.ZoteroPane.getSelectedItems().map(item=>item.id)}));}
   check(refreshes===0,'Local rollback refetched online data');const text=body.querySelector('#reference-num').textContent;check(text.includes('1')&&!text.includes('refflow-'),'Success summary missing '+text);return {refreshes,summary:text,screenshot:await screenshot(body,'rollback-success')};
  }finally{views.refreshReferences=original;}
 });
 await test('native rollback menu presents a localized failure for damaged journals',async()=>{
  const parent=await make('Rollback menu error status'),rows=[ref('10.1234/protect-rollback-menu-error')],batch=await views.importReferences(parent,rows,opts),originalExtra=parent.getField('extra'),prefix='refnexus_record_'+batch.batchId+': ';
  parent.setField('extra',String(originalExtra).split('\n').map(line=>{if(!line.startsWith(prefix))return line;const value=JSON.parse(line.slice(prefix.length));value.attachments=null;return prefix+JSON.stringify(value);}).join('\n'));await parent.saveTx({skipSelect:true});
  try{const body=await select(parent);body.references=rows;await body._cards.render(rows,()=>true);body._cards.menu();const popup=window.document.querySelector('menupopup[data-refflow-menu=references]'),command=[...popup.children].find(node=>/撤回|rollback|ripristin/i.test(node.getAttribute('label')||''));check(command,'Rollback command absent');command.dispatchEvent(new window.Event('command'));popup.hidePopup();
   await wait(()=>/撤回失败|Rollback failed|Ripristino non riuscito/.test(body.querySelector('#reference-num').textContent));check(!rows[0]._item.deleted,'Damaged journal deleted data');return {failureLocalized:true,screenshot:await screenshot(body,'rollback-failure')};
  }finally{parent.setField('extra',originalExtra);await parent.saveTx({skipSelect:true});}
 });
 await test('existing native ownership and attachment protection suite',async()=>{
  const output=cfg.output.replace(/\.json$/,'-ownership.json'),code=await Zotero.File.getContentsAsync(cfg.workspace+'\\scripts\\native-repairs-stage1.js');
  await Object.getPrototypeOf(async function(){}).constructor('Zotero','window','cfg',code)(Zotero,window,{...cfg,output});
  const result=JSON.parse(await Zotero.File.getContentsAsync(output));check(result.failed===0,JSON.stringify(result.tests.filter(row=>!row.ok)));return {passed:result.passed,failed:result.failed};
 });
}finally{Zotero.Translate.Search=native;}
report.finished=new Date().toISOString();report.passed=report.tests.filter(row=>row.ok).length;report.failed=report.tests.filter(row=>!row.ok).length;report.hostErrors=Zotero.getErrors(true).map(String);await save();
