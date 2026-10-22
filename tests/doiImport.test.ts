import './setup';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import BatchImporter from '../src/modules/batchImporter';
import Views from '../src/modules/views';
import ReferenceCards from '../src/modules/referenceCards';

const row=(doi?:string)=>({title:'Provider short title',authors:[],identifiers:doi?{DOI:doi}:{}} as any);
async function fixture(run:(ctx:any)=>Promise<void>){
 const z:any=Zotero,tool:any=ztoolkit;
 const saved=Object.fromEntries(['Libraries','DB','Translate','Item','ItemTypes','ItemFields','Collections','Collection'].map(k=>[k,z[k]]));
 const oldProgress=tool.ProgressWindow,oldUtils=(BatchImporter as any)._utils;
 let ids=100,lookups=0,writes=0,collectionCreates=0;const items:any[]=[];let translate:any=async()=>[{DOI:'10.1234/one',title:'Native full title',creators:[{creatorType:'author',lastName:'Native'}]}];
 class Item {id=0;key='';libraryID=1;itemTypeID=1;fields:any={};relatedItems:string[]=[];collections:number[]=[];creators:any[]=[];
 constructor(public itemType='journalArticle'){} getField(f:string){return this.fields[f]||'';}setField(f:string,v:any){this.fields[f]=v;}
 getCollections(){return [...this.collections];} addToCollection(id:number){this.collections.push(id);}isRegularItem(){return true;}
 getAttachments(){return [];}getCreators(){return this.creators;}setCreators(v:any){this.creators=v;}addRelatedItem(item:any){this.relatedItems.push(item.key);}
 async save(){writes++;if(!this.id){this.id=++ids;this.key='K'+this.id;items.push(this);}return this.id;}
 }
 const parent=new Item();parent.id=1;parent.key='PARENT';parent.fields.title='Parent';parent.collections=[8];
 z.Item=Item;z.ItemTypes={getID:()=>1};z.ItemFields={getID:(f:string)=>f,isValidForType:()=>true};
 z.Libraries={get:()=>({editable:true,filesEditable:true})};z.DB={executeTransaction:(fn:any)=>fn()};
 z.Collections={getAsync:async(id:number)=>({id,libraryID:1})};z.Collection=class{libraryID=1;id=42;async save(){collectionCreates++;}};
 z.Translate={Search:class{setIdentifier(value:any){assert.equal(value.DOI,'10.1234/one');lookups++;}async getTranslators(){return ['fixture'];}setTranslator(){}async translate(opts:any){assert.equal(opts.libraryID,false);assert.equal(opts.saveAttachments,false);return translate();}}};
 tool.ProgressWindow=class{createLine(){return this;}show(){return this;}changeLine(){}changeHeadline(){}startCloseTimer(){}};
 BatchImporter.setUtils({clearLibraryItemCache(){},searchLibraryItem:async(ref:any)=>items.find(i=>i.getField('DOI')===ref.identifiers.DOI),splitCreator:(name:string)=>({name})} as any);
 try{await run({parent,items,z,counts:()=>({lookups,writes,collectionCreates}),setTranslate:(fn:any)=>translate=fn});}
 finally{Object.assign(z,saved);tool.ProgressWindow=oldProgress;(BatchImporter as any)._utils=oldUtils;}
}
const opts={downloadOA:false,createSubCollection:false,createManifestNote:false};
test('actual import chain normalizes DOI, uses native metadata and deduplicates aliases',async()=>fixture(async c=>{
 const refs=[row('https://doi.org/10.1234/ONE'),row('10.1234/one')];const r=await BatchImporter.importAll(c.parent,refs,opts);
 assert.equal(r.importedCount,1);assert.equal(r.existingCount,1);assert.equal(c.counts().lookups,1);assert.equal(c.items[0].getField('title'),'Native full title');assert.equal(refs[0]._item,refs[1]._item);assert.deepEqual(c.items[0].getCollections(),[8]);
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
