import "./setup";
import {test} from "node:test";
import assert from "node:assert/strict";
import {BatchJournal} from "../src/modules/batchJournal";

const clone=(v:any)=>JSON.parse(JSON.stringify(v));
function fixture(){
 const z:any=Zotero,old={win:z.getMainWindow,DB:z.DB,Items:z.Items};
 let file:any,failWrite=false,failCommit=false,writes=0,failAt=0;
 const parent:any={id:501,key:"PARENT01",libraryID:1},child:any={id:502,key:"CHILD001",libraryID:1};
 z.Items={getAsync:async(id:number)=>id===501?parent:id===502?child:undefined};
 z.getMainWindow=()=>({IOUtils:{exists:async()=>file!==undefined,readJSON:async()=>clone(file),writeJSON:async(_path:string,data:any)=>{if(failWrite||writes+1===failAt)throw new Error("disk denied");file=clone(data);writes++;}}});
 z.DB={executeTransaction:async(fn:any)=>{const value=await fn();if(failCommit)throw new Error("DB commit failed");return value;}};
 const record:any={version:2,parentID:501,libraryID:1,createdIDs:[502],relations:[],memberships:[],attachments:[],uses:[],states:{}};
 return {parent,child,record,get file(){return file;},set file(v){file=v;},get writes(){return writes;},set failWrite(v:boolean){failWrite=v;},set failCommit(v:boolean){failCommit=v;},set failAt(v:number){failAt=v;},restore(){z.getMainWindow=old.win;z.DB=old.DB;z.Items=old.Items;}};
}
test("batch evidence persists outside Extra and survives a fresh journal instance",async()=>{
 const f=fixture();try{const j=new BatchJournal();await j.transaction(()=>j.put(f.parent,"refnexus_batch_file",f.record));
 assert.equal(f.file.pending,false);assert.equal(f.file.entries[0].itemKeys[502],"CHILD001");
 f.record.createdIDs.push(999);const reopened=new BatchJournal();const record=await reopened.transaction(()=>reopened.get(f.parent,"refnexus_batch_file"));assert.deepEqual(record?.createdIDs,[502]);
 }finally{f.restore();}
});
test("batch file write failure rejects the database transaction and preserves the old file",async()=>{
 const f=fixture();try{const j=new BatchJournal();await j.transaction(()=>j.put(f.parent,"refnexus_batch_file",f.record));const before=clone(f.file);f.failWrite=true;
 await assert.rejects(j.transaction(async()=>{j.remove(f.parent,"refnexus_batch_file");}),/disk denied/);assert.deepEqual(f.file,before);
 }finally{f.restore();}
});
test("database commit failure restores the previous journal snapshot",async()=>{
 const f=fixture();try{const j=new BatchJournal();await j.transaction(()=>j.put(f.parent,"refnexus_batch_file",f.record));const before=clone(f.file);f.failCommit=true;
 await assert.rejects(j.transaction(async()=>j.remove(f.parent,"refnexus_batch_file")),/DB commit failed/);assert.deepEqual(f.file,before);
 }finally{f.restore();}
});
test("corrupt, newer and interrupted batch files are preserved without admitting writes",async()=>{
 const f=fixture();try{for(const file of [{version:2,pending:false,entries:[]},{version:1,pending:true,entries:[]},{version:1,pending:false,entries:[{}]}]){
 f.file=file;const before=clone(file),writes=f.writes;const j=new BatchJournal();await assert.rejects(j.transaction(async()=>{}));assert.deepEqual(f.file,before);assert.equal(f.writes,writes);
 }}finally{f.restore();}
});
test("rollback evidence refuses a reused numeric item ID with a different key",async()=>{
 const f=fixture();try{const j=new BatchJournal();await j.transaction(()=>j.put(f.parent,"refnexus_batch_file",f.record));f.child.key="REUSED01";await assert.rejects(j.transaction(()=>j.get(f.parent,"refnexus_batch_file")),/identity changed/);
 }finally{f.restore();}
});
test("concurrent journal transactions retain both batches",async()=>{
 const f=fixture();try{const j=new BatchJournal();await Promise.all([j.transaction(()=>j.put(f.parent,"refnexus_batch_first",f.record)),j.transaction(()=>j.put(f.parent,"refnexus_batch_second",f.record))]);assert.equal(f.file.entries.length,2);
 }finally{f.restore();}
});

test("updating an older shared batch does not change the latest-import order",async()=>{
 const f=fixture();try{const j=new BatchJournal();await j.transaction(()=>j.put(f.parent,"refnexus_batch_first",f.record));await j.transaction(()=>j.put(f.parent,"refnexus_batch_second",f.record));await j.transaction(()=>j.put(f.parent,"refnexus_batch_first",f.record));assert.deepEqual(f.file.entries.map((row:any)=>row.batchID),["refnexus_batch_first","refnexus_batch_second"]);
 }finally{f.restore();}
});

test("failure to finalize a committed journal leaves a pending file that blocks later writes",async()=>{
 const f=fixture();try{const j=new BatchJournal();await j.transaction(()=>j.put(f.parent,"refnexus_batch_file",f.record));f.failAt=f.writes+2;
 await assert.rejects(j.transaction(async()=>j.remove(f.parent,"refnexus_batch_file")),/disk denied/);assert.equal(f.file.pending,true);await assert.rejects(j.transaction(async()=>{}),/interrupted transaction/);
 }finally{f.restore();}
});
