import {test} from "node:test";
import assert from "node:assert/strict";
import {retrieveReferenceList,referenceGaps} from "../src/modules/referenceRetrieval";
import {publisherForURL,PUBLISHER_PROFILES} from "../src/modules/publisherReferences";
const refs=(count:number,start=1)=>Array.from({length:count},(_,index)=>({number:start+index,title:`Reference ${index}`,identifiers:{},authors:[]}));
test("automatic mode returns complete local references without external requests",async()=>{
 let calls=0;const result=await retrieveReferenceList([{name:"PDF",run:async()=>({references:refs(4),source:"PDF"})},{name:"Online",run:async()=>{calls++;return;}}]);
 assert.equal(result.source,"PDF");assert.equal(calls,0);
});
test("empty PDF and failed snapshot fall back to a usable online list",async()=>{
 const result=await retrieveReferenceList([{name:"PDF",run:async()=>({references:[],source:"PDF"})},{name:"Snapshot",run:async()=>{throw new Error("Missing file");}},{name:"Online",run:async()=>({references:refs(3),source:"Crossref"})}]);
 assert.equal(result.references.length,3);assert.equal(result.attempts?.length,3);
});
test("partial lists are replaced as a whole, never merged with unrelated index entries",async()=>{
 const result=await retrieveReferenceList([{name:"PDF",run:async()=>({references:refs(2,5),source:"PDF"})},{name:"Online",run:async()=>({references:refs(6),source:"JATS"})}]);
 assert.equal(result.references.length,6);assert.equal(result.source,"JATS");assert.equal(result.partial,false);
});
test("service failure preserves the best available incomplete list",async()=>{
 const result=await retrieveReferenceList([{name:"PDF",run:async()=>({references:refs(5,2),source:"PDF"})},{name:"Online",run:async()=>{throw new Error("HTTP 429");}}]);
 assert.equal(result.references.length,5);assert.equal(result.partial,true);assert.ok(result.attempts?.[1].includes("429"));
});
test("cancellation prevents downstream provider invocation",async()=>{
 const controller=new AbortController();let calls=0;
 await assert.rejects(retrieveReferenceList([{name:"PDF",run:async()=>{controller.abort();return;}},{name:"Online",run:async()=>{calls++;return;}}],controller.signal),{name:"AbortError"});assert.equal(calls,0);
});
test("number gaps are detected while author-year entries remain unnumbered",()=>{
 assert.equal(referenceGaps(refs(3)),false);assert.equal(referenceGaps(refs(3,51)),true);assert.equal(referenceGaps([{title:"Author year",identifiers:{},authors:[]}]),false);
});
test("publisher routing rejects credentials, non-HTTPS and deceptive host suffixes",()=>{
 assert.equal(publisherForURL("https://www.nature.com/articles/example")?.name,"Nature / Springer");
 for(const url of ["http://nature.com/","https://nature.com.attacker.invalid/","https://nature.com@127.0.0.1/","https://user:secret@nature.com/","file:///tmp/nature.com"])assert.equal(publisherForURL(url),undefined);
 assert.equal(PUBLISHER_PROFILES.length,13);
});
