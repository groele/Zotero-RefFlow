import './setup';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import BatchImporter from '../src/modules/batchImporter';
import Views from '../src/modules/views';
import ReferenceCards from '../src/modules/referenceCards';
import Utils from '../src/modules/utils';
import CitationVerifier from '../src/modules/verifier';

const row=(doi?:string)=>({title:'Provider short title',authors:[],identifiers:doi?{DOI:doi}:{}} as any);
async function fixture(run:(ctx:any)=>Promise<void>){
 const z:any=Zotero,tool:any=ztoolkit;
 const saved=Object.fromEntries(['Libraries','DB','Translate','Item','ItemTypes','ItemFields','Collections','Collection','Attachments','getMainWindow','Items','Search'].map(k=>[k,z[k]]));
 const oldProgress=tool.ProgressWindow,oldUtils=(BatchImporter as any)._utils;
 let ids=100,lookups=0,writes=0,collectionCreates=0;const items:any[]=[];let translate:any=async()=>[{DOI:'10.1234/one',title:'Native full title',creators:[{creatorType:'author',lastName:'Native'}]}];
 class Item {id=0;key='';libraryID=1;itemTypeID=1;fields:any={};relatedItems:string[]=[];collections:number[]=[];creators:any[]=[];
 constructor(public itemType='journalArticle'){} getField(f:string){return this.fields[f]||'';}setField(f:string,v:any){this.fields[f]=v;}
 getCollections(){return [...this.collections];} addToCollection(id:number){this.collections.push(id);}isRegularItem(){return true;}
 getAttachments(){return [];}getCreators(){return this.creators;}setCreators(v:any){this.creators=v;}addRelatedItem(item:any){this.relatedItems.push(item.key);}
 async save(){writes++;if(!this.id){this.id=++ids;this.key='K'+this.id;items.push(this);}return this.id;}
 }
 let journal:any;
 z.getMainWindow=()=>({IOUtils:{exists:async()=>journal!==undefined,readJSON:async()=>JSON.parse(JSON.stringify(journal)),writeJSON:async(_path:string,data:any)=>{journal=JSON.parse(JSON.stringify(data));}}});
 z.Search=class{libraryID=1;addCondition(){}async search(){return [];}};
 z.Items={getAsync:async(ids:number|number[])=>Array.isArray(ids)?ids.map(id=>id===1?parent:items.find(item=>item.id===id)).filter(Boolean):ids===1?parent:items.find(item=>item.id===ids)};
 const parent=new Item();parent.id=1;parent.key='PARENT';parent.fields.title='Parent';parent.collections=[8];
 z.Item=Item;z.ItemTypes={getID:()=>1};z.ItemFields={getID:(f:string)=>f,isValidForType:()=>true};
 z.Libraries={get:()=>({editable:true,filesEditable:true})};z.DB={executeTransaction:(fn:any)=>fn()};
 z.Collections={getAsync:async(id:number)=>({id,libraryID:1})};z.Collection=class{libraryID=1;id=42;async save(){collectionCreates++;}};
 z.Translate={Search:class{setIdentifier(value:any){assert.equal(value.DOI,'10.1234/one');lookups++;}async getTranslators(){return ['fixture'];}setTranslator(){}async translate(opts:any){assert.equal(opts.libraryID,false);assert.equal(opts.saveAttachments,false);return translate();}}};
 const progress:any[]=[];
 tool.ProgressWindow=class{createLine(){return this;}show(){return this;}changeLine(value:any){progress.push(value);}changeHeadline(){}startCloseTimer(){}};
 BatchImporter.setUtils({clearLibraryItemCache(){},searchLibraryItem:async(ref:any)=>items.find(i=>ref.identifiers.DOI?CitationVerifier.normalizeDOI(i.getField('DOI'))===CitationVerifier.normalizeDOI(ref.identifiers.DOI):i.getField('title')===ref.title),splitCreator:(name:string)=>({name})} as any);
 try{await run({parent,items,z,progress,counts:()=>({lookups,writes,collectionCreates}),setTranslate:(fn:any)=>translate=fn});}
 finally{Object.assign(z,saved);tool.ProgressWindow=oldProgress;(BatchImporter as any)._utils=oldUtils;}
}
const opts={downloadOA:false,createSubCollection:false,createManifestNote:false};
test('an OA attempt returning no attachment is reported as a download failure',async()=>fixture(async c=>{
 c.z.Attachments={importFromURL:async()=>undefined};
 const result=await BatchImporter.importAll(c.parent,[{...row('10.1234/one'),oaUrl:'https://oa.test/paper.pdf'}],{...opts,downloadOA:true});
 assert.equal(result.importedCount,1);assert.equal(result.failedCount,0);assert.equal(result.downloadCount,0);assert.equal(result.downloadFailedCount,1);
 assert.equal(c.progress.at(-1).type,'fail');assert.match(c.progress.at(-1).text,/PDF/);
}));
test('a rejected OA download remains visible in the completion summary',async()=>fixture(async c=>{
 c.z.Attachments={importFromURL:async()=>{throw new Error('Controlled PDF failure');}};
 const result=await BatchImporter.importAll(c.parent,[{...row('10.1234/one'),oaUrl:'https://oa.test/paper.pdf'}],{...opts,downloadOA:true});
 assert.equal(result.importedCount,1);assert.equal(result.downloadFailedCount,1);assert.equal(c.progress.at(-1).type,'fail');assert.match(c.progress.at(-1).text,/PDF/);
}));
test('disabled OA fetching does not call the downloader or report an attachment failure',async()=>fixture(async c=>{
 let calls=0;c.z.Attachments={importFromURL:async()=>{calls++;}};
 const result=await BatchImporter.importAll(c.parent,[{...row('10.1234/one'),oaUrl:'https://oa.test/paper.pdf'}],opts);
 assert.equal(calls,0);assert.equal(result.downloadFailedCount,0);assert.equal(c.progress.at(-1).type,'success');
}));
test('actual import chain normalizes DOI, uses native metadata and deduplicates aliases',async()=>fixture(async c=>{
 const refs=[row('https://doi.org/10.1234/ONE'),row('10.1234/one')];const r=await BatchImporter.importAll(c.parent,refs,opts);
 assert.equal(r.importedCount,1);assert.equal(r.existingCount,1);assert.equal(c.counts().lookups,1);assert.equal(c.items[0].getField('title'),'Native full title');assert.equal(refs[0]._item,refs[1]._item);assert.deepEqual(c.items[0].getCollections(),[8]);
}));
test('DOI lookup selects matching metadata beyond the first translator row',async()=>fixture(async c=>{
 c.setTranslate(async()=>[{DOI:'10.1234/wrong',title:'Wrong'}, {DOI:'10.1234/one',title:'Matching native title'}]);
 const result=await BatchImporter.importAll(c.parent,[row('10.1234/one')],opts);
 assert.equal(result.importedCount,1);assert.equal(c.items[0].getField('title'),'Matching native title');
}));
test('external item created during DOI lookup is reused before committing',async()=>fixture(async c=>{
 let release:any;c.setTranslate(()=>new Promise(resolve=>release=resolve));
 const refs=[row('10.1234/one')];const job=BatchImporter.importAll(c.parent,refs,opts);
 while(!release)await new Promise(resolve=>setTimeout(resolve,0));
 const external=new c.z.Item();external.setField('DOI','10.1234/one');external.setField('title','External import');await external.save();
 release([{DOI:'10.1234/one',title:'Native'}]);const result=await job;
 assert.equal(result.importedCount,0);assert.equal(result.existingCount,1);assert.equal(c.items.length,1);assert.equal(refs[0]._item,external);
}));
for(const sub of [true,false])test('invalid collection fails without writing even with subcollection '+sub,async()=>fixture(async c=>{
 c.z.Collections={getAsync:async()=>({id:8,libraryID:2})};
 const result=await BatchImporter.importAll(c.parent,[row('10.1234/one')],{...opts,collections:[8],createSubCollection:sub});
 assert.equal(result.failedCount,1);assert.equal(c.counts().writes,0);assert.equal(c.counts().collectionCreates,0);
}));
for(const [name,value] of [['missing DOI',[{title:'Unproven'}]],['conflict',[{DOI:'10.1234/wrong',title:'Wrong'}]],['empty title',[{DOI:'10.1234/one',title:''}]],['empty result',[]]] as any[]){
 test('DOI import rejects '+name+' without writing a partial provider item or empty journal',async()=>fixture(async c=>{c.setTranslate(async()=>value);const r=await BatchImporter.importAll(c.parent,[row('10.1234/one')],{...opts,createSubCollection:true,createManifestNote:true});assert.equal(r.failedCount,1);assert.equal(r.failures.length,1);assert.equal(c.counts().writes,0);assert.equal(c.counts().collectionCreates,0);}));
}
test('no DOI is an explicit skipped failure without lookup or destination creation',async()=>fixture(async c=>{const r=await BatchImporter.importAll(c.parent,[row()],{...opts,createSubCollection:true});assert.equal(r.failedCount,1);assert.match(r.failures[0].reason,/No DOI/);assert.deepEqual(c.counts(),{lookups:0,writes:0,collectionCreates:0});}));
test('timeout never falls back; late metadata cannot save and retry succeeds',async()=>fixture(async c=>{let release:any;c.setTranslate(()=>new Promise(resolve=>release=resolve));const refs=[row('10.1234/one')];const r=await BatchImporter.importAll(c.parent,refs,{...opts,translatorTimeoutMs:10});assert.equal(r.failedCount,1);assert.match(r.failures[0].reason,/timed out/);release([{DOI:'10.1234/one',title:'Late'}]);await Promise.resolve();assert.equal(c.items.length,0);c.setTranslate(async()=>[{DOI:'10.1234/one',title:'Retried'}]);assert.equal((await BatchImporter.importAll(c.parent,refs,opts)).importedCount,1);}));
test('abort stops native metadata wait without saving; retry remains available',async()=>fixture(async c=>{const controller=new AbortController();c.setTranslate(()=>{controller.abort();return new Promise(()=>{});});const r=await BatchImporter.importAll(c.parent,[row('10.1234/one')],{...opts,signal:controller.signal});assert.equal(r.cancelled,true);assert.equal(c.counts().writes,0);}));
test('destination collections and requested DOI remain stable while native lookup is pending',async()=>fixture(async c=>{let release:any;c.setTranslate(()=>new Promise(resolve=>release=resolve));const refs=[row('10.1234/one')],collections=[8];const job=BatchImporter.importAll(c.parent,refs,{...opts,collections});while(!release)await new Promise(resolve=>setTimeout(resolve,0));collections[0]=99;c.parent.collections=[99];refs[0].identifiers.DOI='10.1234/changed';release([{DOI:'10.1234/one',title:'Native'}]);await job;assert.deepEqual(c.items[0].getCollections(),[8]);assert.equal(c.items[0].getField('DOI'),'10.1234/one');}));
test('readonly library fails before DOI lookup and write',async()=>fixture(async c=>{c.z.Libraries={get:()=>({editable:false})};await assert.rejects(BatchImporter.importAll(c.parent,[row('10.1234/one')],opts),/read-only/);assert.deepEqual(c.counts(),{lookups:0,writes:0,collectionCreates:0});}));
test('same-operation double invocation shares one native import and synchronizes both callers',async()=>fixture(async c=>{const views:any=Object.create(Views.prototype);views.disposed=false;views.panes=new Set();views.importJobs=new Map();let release:any;c.setTranslate(()=>new Promise(resolve=>release=resolve));const a=[row('10.1234/one')],b=[row('10.1234/one')];const one=views.importReferences(c.parent,a,opts),two=views.importReferences(c.parent,b,opts);while(!release)await new Promise(resolve=>setTimeout(resolve,0));release([{DOI:'10.1234/one',title:'Native'}]);const results=await Promise.all([one,two]);assert.equal(c.counts().lookups,1);assert.equal(results[0].batchId,results[1].batchId);assert.equal(a[0]._item,b[0]._item);assert.equal(views.importJobs.size,0);}));

test('failed duplicate DOI aliases share a single lookup within the batch',async()=>fixture(async c=>{c.setTranslate(async()=>[]);const r=await BatchImporter.importAll(c.parent,[row('10.1234/ONE'),row('https://doi.org/10.1234/one')],opts);assert.equal(r.failedCount,2);assert.equal(c.counts().lookups,1);assert.equal(c.counts().writes,0);}));
test('metadata-only creation requires an explicit opt-in and never bypasses DOI identity failure',async()=>fixture(async c=>{const refs=[row()];assert.equal((await BatchImporter.importAll(c.parent,refs,{...opts,allowMetadataWithoutDOI:true})).importedCount,1);c.setTranslate(async()=>[]);assert.equal((await BatchImporter.importAll(c.parent,[row('10.1234/one')],{...opts,allowMetadataWithoutDOI:true})).failedCount,1);}));

for(const stillBusy of [true,false])test('late local match cannot overwrite DOI import '+(stillBusy?'while busy':'after completion'),async()=>{
 let release:any;const imported={id:42};const ref:any={title:'Race',identifiers:{DOI:'10.1234/one'},_item:imported};
 const cards:any=Object.create(ReferenceCards.prototype);cards.matchedRows=new WeakSet();cards.providerRetractions=new WeakMap();cards.matchGeneration=1;cards.matchQueue=[];
 cards.views={utils:{searchLibraryItem:()=>new Promise(resolve=>release=resolve)}};
 const row:any={reference:ref,dataset:{importRevision:'0'},isConnected:true,querySelector:()=>({hasAttribute:()=>stillBusy})};
 cards.queueLibraryMatch(row,{libraryID:1},()=>true);const task=cards.matchQueue.shift()();while(!release)await Promise.resolve();row.dataset.importRevision=stillBusy?'1':'2';release(undefined);await task;assert.equal(ref._item,imported);
});

test('independent abort signals never share one import result',async()=>fixture(async c=>{
 const views:any=Object.create(Views.prototype);views.disposed=false;views.panes=new Set();views.importJobs=new Map();
 let release:any;c.setTranslate(()=>new Promise(resolve=>release=resolve));
 const one=views.importReferences(c.parent,[row('10.1234/one')],opts);
 while(!release)await new Promise(resolve=>setTimeout(resolve,0));
 const controller=new AbortController();const two=views.importReferences(c.parent,[row('10.1234/one')],{...opts,signal:controller.signal});
 controller.abort();release([{DOI:'10.1234/one',title:'Native'}]);
 const [a,b]=await Promise.all([one,two]);assert.equal(a.importedCount,1);assert.equal(b.cancelled,true);assert.equal(b.importedCount,0);assert.notEqual(a.batchId,b.batchId);
}));
test('destination deleted during DOI lookup creates no item, collection or journal',async()=>fixture(async c=>{
 let release:any;c.setTranslate(()=>new Promise(resolve=>release=resolve));const job=BatchImporter.importAll(c.parent,[row('10.1234/one')],{...opts,createSubCollection:true});
 while(!release)await new Promise(resolve=>setTimeout(resolve,0));c.z.Collections={getAsync:async()=>undefined};release([{DOI:'10.1234/one',title:'Native'}]);
 const result=await job;assert.equal(result.failedCount,1);assert.equal(result.failures[0].code,'destination');assert.equal(c.counts().writes,0);assert.equal(c.counts().collectionCreates,0);
}));
test('reference-array edits during lookup do not corrupt caller synchronization',async()=>fixture(async c=>{
 let release:any;c.setTranslate(()=>new Promise(resolve=>release=resolve));const ref=row('10.1234/one'),refs=[ref];
 const job=BatchImporter.importAll(c.parent,refs,opts);while(!release)await new Promise(resolve=>setTimeout(resolve,0));refs.splice(0,1);
 release([{DOI:'10.1234/one',title:'Native'}]);assert.equal((await job).importedCount,1);assert.equal(ref._item,c.items[0]);
}));
test('no DOI still reuses an existing local item without a translator',async()=>fixture(async c=>{
 const existing=new c.z.Item();existing.setField('title','Provider short title');await existing.save();
 const result=await BatchImporter.importAll(c.parent,[row()],opts);assert.equal(result.existingCount,1);assert.equal(c.counts().lookups,0);
}));
test('import lookup bypasses display caches and stale-generation miss handling',async()=>{
 const utils:any=Object.create(Utils.prototype),target={id:4};let lookups=0;
 utils.itemCache=new Map([['1:doi:10.1234/one:library-item',null]]);utils.searchItem=async()=>{lookups++;return target;};
 assert.equal(await utils.searchLibraryItem(row('10.1234/one'),1,true),target);assert.equal(lookups,1);
});
test('import destinations use same-window same-library collection snapshots',()=>{
 const utils:any=Object.create(Utils.prototype);const parent:any={libraryID:2,getCollections:()=>[8,9]};
 const win:any={ZoteroPane:{getSelectedCollections:()=>[{id:3,libraryID:1},{id:4,libraryID:2},{id:4,libraryID:2},{id:5,libraryID:2,deleted:true}]}};
 assert.deepEqual(utils.importCollections(parent,win),[4]);win.ZoteroPane.getSelectedCollections=()=>[{id:3,libraryID:1}];assert.deepEqual(utils.importCollections(parent,win),[8,9]);
});


test('already cancelled queued import never starts legacy migration',async()=>fixture(async c=>{
 const importer:any=BatchImporter,original=importer.migrateRecords;let migrations=0;
 importer.migrateRecords=async()=>{migrations++;};
 try{const controller=new AbortController();controller.abort();const result=await BatchImporter.importAll(c.parent,[row('10.1234/one')],{...opts,signal:controller.signal});assert.equal(result.cancelled,true);assert.equal(migrations,0);assert.equal(c.counts().writes,0);}
 finally{importer.migrateRecords=original;}
}));
