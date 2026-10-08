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

test("legacy rollback checks exact ownership and keeps the parent, other libraries, and prefix matches",async()=>{
  const z:any=Zotero,originalItems=z.Items,originalLibraries=z.Libraries;
  const id='ref_batch_20260929_120000';let trashed:number[]=[];
  const item=(itemID:number,libraryID:number,extra:string)=>({id:itemID,libraryID,deleted:false,isRegularItem:()=>true,getField:()=>extra});
  z.Libraries={get:()=>({editable:true})};
  z.Items={getAsync:async()=>[item(101,1,`import_batch: ${id}`),item(102,1,`import_batch: ${id}_other`),item(103,2,`import_batch: ${id}`),item(999,1,`import_batch: ${id}`)],trashTx:async(ids:number[])=>trashed=ids};
  let extra=`ref_batch_parent: ${id}\nkeep this user text`;
  const parent:any={id:999,libraryID:1,getField:()=>extra,setField:(_:string,value:string)=>extra=value,saveTx:async()=>{}};
  try {
    assert.equal(await BatchImporter.rollbackBatch(parent,id),1);assert.deepEqual(trashed,[101]);assert.equal(extra,'keep this user text');
    trashed=[];assert.equal(await BatchImporter.rollbackBatch(parent,id),0);assert.deepEqual(trashed,[]);
  }finally{z.Items=originalItems;z.Libraries=originalLibraries;}
});

test("rollback refuses a journal belonging to another parent",async()=>{
  const z:any=Zotero,original=z.Libraries;z.Libraries={get:()=>({editable:true})};
  const id='refnexus_batch_test';
  const record={version:1,parentID:123,libraryID:1,createdIDs:[],relations:[],memberships:[],attachments:[]};
  const parent:any={id:999,libraryID:1,getField:()=>`refnexus_batch_parent: ${id}\nrefnexus_record_${id}: ${JSON.stringify(record)}`};
  try{await assert.rejects(BatchImporter.rollbackBatch(parent,id),/ownership/);}finally{z.Libraries=original;}
});
