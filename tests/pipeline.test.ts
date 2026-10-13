import "./setup";
import {test} from "node:test";
import assert from "node:assert/strict";
import Requests from "../src/modules/requests";
import Storage from "../src/modules/localStorage";
import OpenAlex from "../src/modules/openalex";
import SemanticScholar from "../src/modules/semanticScholar";
import API from "../src/modules/api";
import PDF from "../src/modules/pdf";
import ReferenceTasks from "../src/modules/referenceTasks";
import BatchImporter from "../src/modules/batchImporter";
import {OperationBudget} from "../src/modules/operationBudget";
import {utf8Bytes} from "../src/modules/jsonData";
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
test("native translator DOI conflict cannot relabel metadata as the requested publication",async()=>{
  const host:any=Zotero,original=host.Translate;
  host.Translate={Search:class{setIdentifier(){}async getTranslators(){return ["fixture"];}setTranslator(){}async translate(){return [{DOI:"10.1234/wrong",title:"Wrong publication"}];}}};
  try{assert.equal(await (BatchImporter as any).translatedMetadata("10.1234/expected",100),undefined);}finally{host.Translate=original;}
});
test("pane cancellation settles even when the job ignores its signal",async()=>{
  const tasks=new ReferenceTasks(),pane={};let signal:any;
  const pending=tasks.run(pane,"blocked",async context=>{signal=context.signal;await new Promise(()=>{});});
  await Promise.resolve();tasks.invalidate(pane);await pending;assert.equal(signal.aborted,true);assert.equal(tasks.size,0);tasks.dispose();
});
test("whole-pane deadline cleans up and prevents late commits",async()=>{
  const tasks=new ReferenceTasks(20),pane={};let expired=0,release:any,committed=false;
  const pending=tasks.run(pane,"blocked",async context=>{await new Promise(resolve=>{release=resolve;});if(context.isCurrent())committed=true;},{onTimeout:()=>expired++});
  await pending;assert.equal(expired,1);assert.equal(tasks.metrics.timeouts,1);assert.equal(tasks.size,0);release();await Promise.resolve();assert.equal(committed,false);tasks.dispose();
});

test("UTF8 accounting matches the platform including Chinese and supplementary characters",()=>{
  for(const text of ["plain","中文𝛼","a\ud800b",JSON.stringify({text:"中文𝛼"})])assert.equal(utf8Bytes(text),Buffer.byteLength(text,"utf8"));
});
test("operation deadline settles an uncooperative operation and suppresses late success",async()=>{
  const budget=new OperationBudget(undefined,20);let release:any;
  try{const pending=budget.run(async()=>new Promise(resolve=>{release=resolve;}));assert.equal(await pending,undefined);release("late");assert.equal(await budget.run(async()=>"restart"),undefined);assert.equal(budget.signal.aborted,true);}finally{budget.dispose();}
});
test("pre-start cancellation avoids invoking an operation",async()=>{
  const controller=new AbortController(),budget=new OperationBudget(controller.signal);let calls=0;
  try{const pending=budget.run(async()=>{calls++;});controller.abort();await assert.rejects(pending,{name:"AbortError"});assert.equal(calls,0);}finally{budget.dispose();}
});
test("OpenAlex total deadline includes DOI lookup and a stalled later page preserves partial results",async()=>{
  const stalled=new OpenAlex({get:async()=>new Promise(()=>{})} as any);
  await assert.rejects(stalled.getNeighborhood("10.1234/origin","Citations",undefined,20),/lookup failed/);
  let pages=0;
  const provider=new OpenAlex({get:async(url:string)=>url.includes("/works/doi:")?{id:"https://openalex.org/W1",doi:"10.1234/origin"}:
    ++pages===1?{meta:{count:2,next_cursor:"next"},results:[{id:"https://openalex.org/W2",title:"First page"}]}:new Promise(()=>{})} as any);
  const result=await provider.getNeighborhood("10.1234/origin","Citations",undefined,20);
  assert.equal(result.references.length,1);assert.equal(result.truncated,true);assert.equal(pages,2);
});
test("hydration bounds producer concurrency, checks requested IDs and keeps their order",async()=>{
  let active=0,peak=0,calls=0;
  const provider=new OpenAlex({get:async(url:string)=>{
    active++;peak=Math.max(peak,active);calls++;await delay(2);active--;
    const ids=new URL(url).searchParams.get("filter")!.replace(/^openalex:/,"").split("|");
    return {results:[...ids.reverse().map(id=>({id:"https://openalex.org/"+id,title:"Title "+id})),{id:"https://openalex.org/W99999",title:"Wrong identity"}]};
  }} as any);
  const ids=Array.from({length:1000},(_,index)=>"https://openalex.org/W"+(index+1));
  const result=await provider.hydrateBatch(ids);
  assert.equal(calls,10);assert.ok(peak<=4);assert.equal(result.length,1000);assert.equal(result[0].openalexId,ids[0]);assert.equal(result.at(-1)?.openalexId,ids.at(-1));
});
test("hydration deadline stops launching remaining chunks",async()=>{
  let calls=0;
  const provider=new OpenAlex({get:async()=>{calls++;return new Promise(()=>{});}} as any);
  const result=await provider.hydrateBatch(Array.from({length:1000},(_,i)=>"W"+(i+1)),undefined,20);
  assert.equal(result.length,0);assert.equal(calls,4);
});
test("Semantic Scholar deduplicates aliases by DOI even when paper IDs differ",async()=>{
  const paper={title:"One publication",authors:[],externalIds:{DOI:"10.1234/one"}};
  const provider=new SemanticScholar({get:async()=>({data:[{citedPaper:{...paper,paperId:"a"}},{citedPaper:{...paper,paperId:"b"}}]})} as any);
  const result=await provider.neighborhood("10.1234/origin","References");assert.equal(result?.references.length,1);assert.equal(result?.partial,true);
});
test("Semantic Scholar deadline preserves an earlier page",async()=>{
  let pages=0;
  const provider=new SemanticScholar({get:async()=>++pages===1?{data:[{citedPaper:{paperId:"a",title:"One publication",authors:[]}}],next:100}:new Promise(()=>{})} as any);
  const result=await provider.neighborhood("10.1234/origin","References",undefined,500,20);assert.equal(result?.references.length,1);assert.equal(result?.partial,true);
});
test("incomplete Crossref lists try Semantic Scholar as a whole alternative",async()=>{
  const api=new API({} as any);
  api.requests.get=async()=>({message:{DOI:"10.1234/origin",title:["Origin"],"reference-count":10,reference:[{"article-title":"Primary one"}]}});
  api.openAlex.getWorkByDOI=async()=>undefined;
  let calls=0;api.getDOIReferenceListBySemanticScholar=async()=>{calls++;return {source:"SemanticScholar",references:Array.from({length:10},(_,i)=>({title:"Alternative "+i,identifiers:{},sources:["SemanticScholar"]}))};};
  try{const info=await api.getDOIInfoByCrossref("10.1234/origin");assert.equal(calls,1);assert.equal(info?.references?.length,10);assert.equal(info?.references?.[0].title,"Alternative 0");assert.equal(info?.referencePartial,false);}finally{api.requests.dispose();api.publisherReferences.dispose();}
});
test("unresolved Semantic Scholar entries cannot establish an authoritative empty list",async()=>{
  const api=new API({} as any);api.requests.get=async()=>({message:{DOI:"10.1234/origin",title:["Origin"]}});api.openAlex.getWorkByDOI=async()=>undefined;
  api.getDOIReferenceListBySemanticScholar=async()=>({references:[],source:"SemanticScholar",partial:true});
  try{const info=await api.getDOIInfoByCrossref("10.1234/origin");assert.equal(info?.referencePartial,true);}finally{api.requests.dispose();api.publisherReferences.dispose();}
});
test("ambiguous title enrichment cannot assign an arbitrary DOI",async()=>{
  const api=new API({} as any),title="Quantum optical response in layered semiconductors";
  api.requests.get=async()=>({message:{DOI:"10.1234/origin",title:["Origin"],reference:[{"article-title":title,author:"Smith",year:"2024"}]}});
  api.openAlex.getWorkByDOI=async()=>({work:{},referencedWorks:["W1","W2"]});
  api.openAlex.hydrateBatch=async()=>["one","two"].map(id=>({title,authors:["Smith"],year:"2024",doi:"10.1234/"+id,openalexId:id,isOA:true}));
  try{const info=await api.getDOIInfoByCrossref("10.1234/origin");assert.equal(info?.references?.[0].identifiers.DOI,undefined);}finally{api.requests.dispose();api.publisherReferences.dispose();}
});
test("HTTP cache enforces byte and entry limits and owns returned nested data",()=>{
  const client=new Requests({cacheMaxBytes:300,cacheEntryMaxBytes:160});
  const input={nested:["中文"]};client.setCache("one",input);input.nested.push("mutation");
  const first=client.getCache("one");first.nested.push("later");assert.deepEqual(client.getCache("one"),{nested:["中文"]});
  for(let i=0;i<10;i++)client.setCache(String(i),{text:"a".repeat(100)});assert.ok(client.cacheUsage.bytes<=300);assert.ok(client.cacheUsage.entries<=2);
  client.setCache("oversized",{text:"a".repeat(300)});assert.equal(client.getCache("oversized"),undefined);client.clearCache();assert.equal(client.cacheUsage.bytes,0);client.dispose();
});
test("shared HTTP consumers receive independent response objects",async()=>{
  const original=Zotero.HTTP.request,client=new Requests();let release:any,calls=0;
  Zotero.HTTP.request=async()=>{calls++;return new Promise(resolve=>{release=resolve;});};
  try{const a=client.get("https://api.test/owned"),b=client.get("https://api.test/owned");release({status:200,response:{nested:{value:1}}});const [first,second]=await Promise.all([a,b]);first.nested.value=2;assert.equal(second.nested.value,1);assert.equal((await client.get("https://api.test/owned")).nested.value,1);assert.equal(calls,1);}finally{client.dispose();Zotero.HTTP.request=original;}
});
test("authentication POST bypasses cache without disabling cacheable search POST",async()=>{
  const original=Zotero.HTTP.request,client=new Requests();let calls=0;Zotero.HTTP.request=async()=>({status:200,response:{token:++calls}});
  try{const body={Username:"fixture",Password:"fixture"};await client.post("https://api.test/auth",body,"json",{},undefined,{cache:false});await client.post("https://api.test/auth",body,"json",{},undefined,{cache:false});assert.equal(calls,2);assert.equal(client.cacheUsage.entries,0);await client.post("https://api.test/search",{});await client.post("https://api.test/search",{});assert.equal(calls,3);}finally{client.dispose();Zotero.HTTP.request=original;}
});
test("persistent cache owns data, rejects unknown library and caps UTF8 size",async()=>{
  const storage=new Storage("bounded-test",{maxBytes:500,entryMaxBytes:250});const item={key:"OWNED",libraryID:1},input={nested:["中文"]};
  try{await storage.set({key:"UNSCOPED"},"data",1);assert.equal(storage.get({key:"UNSCOPED"},"data"),undefined);await storage.set(item,"data",input);input.nested.push("changed");const value=storage.get(item,"data");value.nested.push("later");assert.deepEqual(storage.get(item,"data"),{nested:["中文"]});for(let i=0;i<10;i++)await storage.set({key:"K"+i,libraryID:1},"data","a".repeat(100));assert.ok(storage.cacheUsage.bytes<=500);await storage.set(item,"data","a".repeat(500));assert.equal(storage.get(item,"data"),undefined);assert.ok(storage.metrics.evictions>0);assert.equal(storage.metrics.skipped,1);}finally{await storage.dispose();}
});
test("failed atomic cache write remains retryable",async()=>{
  const original=Zotero.File.putContentsAsync;let attempts=0,last="";
  Zotero.File.putContentsAsync=async(_path,snapshot)=>{if(++attempts===1)throw new Error("Controlled disk failure");last=String(snapshot);};
  const storage=new Storage("retry-test");
  try{await storage.set({key:"OWNED",libraryID:1},"data",1);await assert.rejects(storage.flush(),/Controlled disk failure/);await storage.set({key:"OWNED",libraryID:1},"data",2);await storage.flush();assert.equal(JSON.parse(last)["1:OWNED"].data,2);assert.equal(storage.metrics.writeFailures,1);}finally{await storage.dispose();Zotero.File.putContentsAsync=original;}
});
test("a continued reference heading does not hide the PDF scan limit",async()=>{
  const host:any=Zotero,original=host.SDT;
  const node=(text:string,y:number)=>({text,anchor:{textMap:JSON.stringify([[0,4,40,y,600,y+10,...Array.from(text.replace(/\s/g,"")).map(()=>5)]])}});
  host.SDT={getReader:async()=>({header:{schemaVersion:"1.2.0"},getCatalog:async()=>({pages:Array.from({length:5},()=>({viewRect:[0,0,612,792]}))}),getPageBlocks:async()=>[node("References",750),node("[51] Smith, J. Continued citation. Journal, 2024.",720)]})};
  const pdf=new PDF({refText2Info:(text:string)=>({title:text,identifiers:{}})} as any),attachment:any={id:1,attachmentContentType:"application/pdf",getAttachmentLastPageIndex:()=>4};
  try{await pdf.getReferences(attachment,false,{maxPages:1,notify:false});assert.equal(pdf.getDiagnostics(attachment)?.headingFound,true);assert.equal(pdf.getDiagnostics(attachment)?.scanLimited,true);}finally{host.SDT=original;}
});
