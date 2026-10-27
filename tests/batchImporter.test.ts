import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import BatchImporter from "../src/modules/batchImporter";

test("rapid batch IDs cannot collide in the same second",()=>{
  const ids=Array.from({length:1000},()=>BatchImporter.generateBatchId());
  assert.equal(new Set(ids).size,1000);
  assert.match(ids[0],/^refnexus_batch_\d{8}_\d{6}_\d{3}_\d+$/);
});

test("manifest note escapes imported titles and authors",()=>{
  const parent:any={getField:()=>'<img src=x onerror=bad()> & Parent'};
  const html=(BatchImporter as any).manifestHTML(parent,[{title:'<script>bad()</script>',authors:['A & B'],identifiers:{},year:'2024'}],'batch');
  assert.ok(!html.includes('<script>') && !html.includes('<img'));
  assert.ok(html.includes('&lt;script&gt;') && html.includes('A &amp; B'));
});

function journalEnvironment(){
 const z:any=Zotero,window=z.getMainWindow,db=z.DB;
 z.getMainWindow=()=>({IOUtils:{exists:async()=>false}});z.DB={executeTransaction:async(fn:any)=>fn()};
 return ()=>{z.getMainWindow=window;z.DB=db;};
}
test("legacy rollback retains creations without a user-edit baseline and keeps unrelated markers",async()=>{
  const restoreJournal=journalEnvironment();
  const z:any=Zotero,originalItems=z.Items,originalLibraries=z.Libraries;
  const id='ref_batch_20260929_120000';let trashed:number[]=[];
  const item=(itemID:number,libraryID:number,extra:string)=>({id:itemID,libraryID,deleted:false,isRegularItem:()=>true,getField:()=>extra});
  z.Libraries={get:()=>({editable:true})};
  z.Items={getAsync:async()=>[item(101,1,`import_batch: ${id}`),item(102,1,`import_batch: ${id}_other`),item(103,2,`import_batch: ${id}`),item(999,1,`import_batch: ${id}`)],trashTx:async(ids:number[])=>trashed=ids};
  let extra=`ref_batch_parent: ${id}\nkeep this user text\nResearch note: ${id}`;
  const parent:any={id:999,libraryID:1,getField:()=>extra,setField:(_:string,value:string)=>extra=value,save:async()=>{},saveTx:async()=>{}};
  try {
    assert.equal(await BatchImporter.rollbackBatch(parent,id),0);assert.deepEqual(trashed,[]);assert.deepEqual(BatchImporter.lastRollback.retainedIDs,[101]);assert.equal(extra,`keep this user text\nResearch note: ${id}`);
    trashed=[];assert.equal(await BatchImporter.rollbackBatch(parent,id),0);assert.deepEqual(trashed,[]);
  }finally{z.Items=originalItems;z.Libraries=originalLibraries;restoreJournal();}
});

test("rollback refuses a journal belonging to another parent",async()=>{
  const restoreJournal=journalEnvironment();
  const z:any=Zotero,original=z.Libraries;z.Libraries={get:()=>({editable:true})};
  const id='refnexus_batch_test';
  const record={version:1,parentID:123,libraryID:1,createdIDs:[],relations:[],memberships:[],attachments:[]};
  const parent:any={id:999,libraryID:1,getField:()=>`refnexus_batch_parent: ${id}\nrefnexus_record_${id}: ${JSON.stringify(record)}`};
  try{await assert.rejects(BatchImporter.rollbackBatch(parent,id),/ownership/);}finally{z.Libraries=original;restoreJournal();}
});

test("legacy migration preserves a manual Extra edit made while child identities load",async()=>{
 const z:any=Zotero,original={win:z.getMainWindow,Items:z.Items,Search:z.Search,DB:z.DB};
 let file:any,extra="SCI: 是",late=false;
 const record:any={version:2,parentID:501,libraryID:1,createdIDs:[502],relations:[],memberships:[],attachments:[]};
 extra+='\nrefnexus_batch_parent: refnexus_batch_migrate\nrefnexus_record_refnexus_batch_migrate: '+JSON.stringify(record);
 const parent:any={id:501,key:"PARENT01",libraryID:1,getField:()=>extra,setField:(_key:string,value:string)=>extra=value,save:async()=>{}};
 let childExtra='import_batch: refnexus_batch_migrate';const child:any={id:502,key:"CHILD001",libraryID:1,getField:()=>childExtra,setField:(_key:string,value:string)=>childExtra=value,save:async()=>{}};
 z.Search=class{addCondition(){}async search(){return [];}};
 z.Items={getAsync:async(id:any)=>{if(Array.isArray(id))return [];if(id===502){if(!late){late=true;extra+='\nLate manual note';}return child;}return parent;}};
 z.DB={executeTransaction:async(fn:any)=>fn()};z.getMainWindow=()=>({IOUtils:{exists:async()=>Boolean(file),readJSON:async()=>file,writeJSON:async(_p:string,data:any)=>file=JSON.parse(JSON.stringify(data))}});
 try{const journal=(await import('../src/modules/batchJournal')).default;await journal.transaction(()=>(BatchImporter as any).migrateRecords(1,parent));assert.equal(extra,'SCI: 是\nLate manual note');assert.equal(childExtra,'');assert.equal(file.entries.length,1);}
 finally{z.getMainWindow=original.win;z.Items=original.Items;z.Search=original.Search;z.DB=original.DB;}
});


test("per-call rollback results retain ownership across concurrent libraries",async()=>{
 const original=(BatchImporter as any).rollback,previous=BatchImporter.lastRollback;
 try{(BatchImporter as any).rollback=async(parent:any,_batch:string,outcome:any)=>{outcome.retainedIDs=[parent.id];await new Promise(resolve=>setTimeout(resolve,parent.libraryID===1?8:1));BatchImporter.lastRollback={retainedIDs:[999]};return parent.id;};
 const [a,b]=await Promise.all([BatchImporter.rollbackBatchDetailed({id:11,libraryID:1} as any,"a"),BatchImporter.rollbackBatchDetailed({id:22,libraryID:2} as any,"b")]);
 assert.deepEqual(a,{removed:11,retainedIDs:[11]});assert.deepEqual(b,{removed:22,retainedIDs:[22]});
 }finally{(BatchImporter as any).rollback=original;BatchImporter.lastRollback=previous;}
});
