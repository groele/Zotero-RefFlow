import "./setup";
import {test} from "node:test";
import assert from "node:assert/strict";
import {BatchJournal} from "../src/modules/batchJournal";

const clone=(v:any)=>JSON.parse(JSON.stringify(v));
function fixture(){
 const z:any=Zotero,old={win:z.getMainWindow,DB:z.DB,Items:z.Items};
 let file:any,backup:any,failWrite=false,failCommit=false,writes=0,failAt=0;
 const parent:any={id:501,key:"PARENT01",libraryID:1},child:any={id:502,key:"CHILD001",libraryID:1};
 z.Items={getAsync:async(id:number)=>id===501?parent:id===502?child:undefined};
 z.getMainWindow=()=>({IOUtils:{exists:async(path:string)=>path.endsWith('.previous')?backup!==undefined:file!==undefined,readJSON:async(path:string)=>clone(path.endsWith('.previous')?backup:file),writeJSON:async(_path:string,data:any)=>{if(_path.endsWith('.previous')){if(failWrite)throw new Error('disk denied');backup=clone(data);return;}if(failWrite||writes+1===failAt)throw new Error("disk denied");file=clone(data);writes++;}}});
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

test("known committed finalization failure can finish saving without repeating database work",async()=>{
 const f=fixture();try{const j=new BatchJournal();await j.transaction(()=>j.put(f.parent,"refnexus_batch_file",f.record));f.failAt=f.writes+2;
 await assert.rejects(j.transaction(async()=>j.remove(f.parent,"refnexus_batch_file")),/database committed/);assert.equal(f.file.pending,true);f.failAt=0;await j.retryCommitted();assert.equal(f.file.pending,false);
 }finally{f.restore();}
});


test("missing stable keys reject live objects including uses-only targets",async()=>{
 const f=fixture();try{const j=new BatchJournal();await j.transaction(()=>j.put(f.parent,"refnexus_batch_keys",f.record));
 delete f.file.entries[0].itemKeys[502];await assert.rejects(j.transaction(()=>j.get(f.parent,"refnexus_batch_keys")),/incomplete/);
 f.file.entries[0].record.createdIDs=[];f.file.entries[0].record.uses=[{id:502,parents:[501],collections:[]}];await assert.rejects(j.transaction(()=>j.get(f.parent,"refnexus_batch_keys")),/incomplete/);
 }finally{f.restore();}
});
test("cross-library live identity is rejected rather than rewritten",async()=>{
 const f=fixture();try{const j=new BatchJournal();f.child.libraryID=2;await assert.rejects(j.transaction(()=>j.put(f.parent,"refnexus_batch_cross",f.record)),/another library/);assert.equal(f.file,undefined);
 }finally{f.restore();}
});
test("scoped transaction isolates a malformed other-library record without deleting it",async()=>{
 const f=fixture();try{const j=new BatchJournal();await j.transaction(()=>j.put(f.parent,"refnexus_batch_safe",f.record),1);
 const bad={batchID:"refnexus_batch_bad",record:{libraryID:2}};f.file.entries.push(bad);
 const record=await j.transaction(()=>j.get(f.parent,"refnexus_batch_safe"),1);assert.equal(record?.parentID,501);
 await j.transaction(async()=>{j.remove(f.parent,"refnexus_batch_safe");},1);assert.deepEqual(f.file.entries,[bad]);
 await assert.rejects(j.transaction(async()=>{},2));
 }finally{f.restore();}
});
test("scoped transaction cannot write a different library",async()=>{
 const f=fixture();try{const j=new BatchJournal();await assert.rejects(j.transaction(()=>j.put(f.parent,"refnexus_batch_scope",f.record),2),/another library/);assert.equal(f.file,undefined);
 }finally{f.restore();}
});
test("unattributable corruption remains globally blocked",async()=>{
 const f=fixture();try{f.file={version:1,pending:false,entries:[{}]};const before=clone(f.file);const j=new BatchJournal();await assert.rejects(j.transaction(async()=>{},1),/owner/);assert.deepEqual(f.file,before);
 }finally{f.restore();}
});
test("next transaction finalizes a known commit before executing new business work",async()=>{
 const f=fixture();try{const j=new BatchJournal();f.failAt=2;let callbacks=0;
 await assert.rejects(j.transaction(async()=>{callbacks++;await j.put(f.parent,"refnexus_batch_resume",f.record);}),/database committed/);assert.equal(f.file.pending,true);
 f.failAt=0;await j.transaction(async()=>{callbacks++;assert.equal(f.file.pending,false);});assert.equal(callbacks,2);assert.equal(f.file.entries.length,1);
 }finally{f.restore();}
});
test("fresh process cannot finalize unknown pending evidence",async()=>{
 const f=fixture();try{const j=new BatchJournal();f.failAt=2;await assert.rejects(j.transaction(()=>j.put(f.parent,"refnexus_batch_pending",f.record)));f.failAt=0;
 const reopened=new BatchJournal();assert.equal((await reopened.diagnostics()).canRetry,false);await assert.rejects(reopened.retryCommitted(),/No in-process/);assert.equal(f.file.pending,true);
 }finally{f.restore();}
});
test("failed recovery preserves pending evidence and remains retryable",async()=>{
 const f=fixture();try{const j=new BatchJournal();f.failAt=2;await assert.rejects(j.transaction(()=>j.put(f.parent,"refnexus_batch_retry",f.record)));const before=clone(f.file);
 f.failWrite=true;await assert.rejects(j.retryCommitted());assert.deepEqual(f.file,before);f.failWrite=false;f.failAt=0;assert.equal((await j.diagnostics()).canRetry,true);await j.retryCommitted();assert.equal(f.file.pending,false);
 }finally{f.restore();}
});
test("changed pending file is never overwritten by in-process recovery",async()=>{
 const f=fixture();try{const j=new BatchJournal();f.failAt=2;await assert.rejects(j.transaction(()=>j.put(f.parent,"refnexus_batch_changed",f.record)));f.failAt=0;f.file.entries=[];
 await assert.rejects(j.retryCommitted(),/evidence changed/);assert.deepEqual(f.file.entries,[]);assert.equal((await j.diagnostics()).canRetry,false);
 }finally{f.restore();}
});
test("read-only and identical journal updates do not rewrite journal files",async()=>{
 const f=fixture();try{const j=new BatchJournal();await j.transaction(()=>j.put(f.parent,"refnexus_batch_noop",f.record));const writes=f.writes;
 await j.transaction(()=>j.get(f.parent,"refnexus_batch_noop"));await j.transaction(()=>j.put(f.parent,"refnexus_batch_noop",f.record));assert.equal(f.writes,writes);assert.equal((await j.diagnostics()).backupAvailable,true);
 }finally{f.restore();}
});
