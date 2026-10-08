import "./setup";
import {test,describe} from "node:test";
import assert from "node:assert/strict";
import OpenAlexProvider from "../src/modules/openalex";
const work=(id:string)=>({id:"https://openalex.org/"+id,title:"Title "+id,doi:"https://doi.org/10.1234/"+id,authorships:[{author:{display_name:"A Smith"}}],publication_year:2024,primary_location:{source:{display_name:"Journal"}},open_access:{is_oa:true},cited_by_count:4});
describe("OpenAlex literature modes",()=>{
 test("100 unique IDs require one hydration request with the modern limit",async()=>{
  const urls:string[]=[];const provider=new OpenAlexProvider({get:async(url:string)=>{urls.push(url);return {results:Array.from({length:100},(_,i)=>work('W'+(i+1)))}}} as any);
  const result=await provider.hydrateBatch(Array.from({length:100},(_,i)=>'https://openalex.org/W'+(i+1)));
  assert.equal(urls.length,1);assert.match(urls[0],/per_page=100/);assert.equal(result.length,100);
 });
 test("optional key is sent in a header and absent from request URLs",async()=>{
  const get=Zotero.Prefs.get;let received:any;Zotero.Prefs.get=()=>"private-test-token";
  try{const provider=new OpenAlexProvider({get:async(url:string,_type:string,headers:any)=>{received={url,headers};return work("W1");}} as any);await provider.getWorkByDOI("10.1234/base");assert.equal(received.headers.Authorization,"Bearer private-test-token");assert.ok(!received.url.includes("private-test-token"));}finally{Zotero.Prefs.get=get;}
 });
 test("citations use cursor pagination, deduplicate and mark incomplete snapshots",async()=>{
  const urls:string[]=[];
  const provider=new OpenAlexProvider({get:async(url:string)=>{urls.push(url);if(url.includes("/works/doi:"))return {...work("W1"),referenced_works:[]};if(url.includes("cursor=*"))return {meta:{count:3,next_cursor:"next"},results:[work("W2"),work("W3")]};return {meta:{count:3},results:[work("W3"),work("W4")]};}} as any);
  const result=await provider.getNeighborhood("10.1234/base","Citations");
  assert.equal(result.references.length,3);assert.equal(result.truncated,false);assert.equal(result.total,3);assert.ok(urls[1].includes("cites%3AW1"));assert.ok(urls[1].includes("per_page=100"));assert.equal(result.references[0].identifiers.DOI,"10.1234/w2");
 });
 test("failed later pages preserve partial results and identify them",async()=>{
  let pages=0;const provider=new OpenAlexProvider({get:async(url:string)=>url.includes("/works/doi:")?work("W1"):++pages===1?{meta:{count:200,next_cursor:"next"},results:[work("W2")]}:undefined} as any);
  const result=await provider.getNeighborhood("10.1234/base","Citations");assert.equal(result.truncated,true);assert.equal(result.references.length,1);
 });
 test("related works preserve provider order after hydration",async()=>{
  const provider=new OpenAlexProvider({get:async(url:string)=>url.includes("/works/doi:")?{...work("W1"),related_works:["https://openalex.org/W3","https://openalex.org/W2"]}:{results:[work("W2"),work("W3")]}} as any);
  const result=await provider.getNeighborhood("10.1234/base","Related");assert.deepEqual(result.references.map(ref=>ref.title),["Title W3","Title W2"]);assert.equal(result.truncated,false);
 });
 test("lookup failure is visible rather than a fabricated empty list",async()=>{
  const provider=new OpenAlexProvider({get:async()=>undefined} as any);await assert.rejects(()=>provider.getNeighborhood("10.1234/base","Citations"),/lookup failed/);
 });
 test("already aborted requests never launch a lookup",async()=>{
  let calls=0;const provider=new OpenAlexProvider({get:async()=>{calls++;return work("W1");}} as any);const controller=new AbortController();controller.abort();await assert.rejects(()=>provider.getNeighborhood("10.1234/base","Related",controller.signal));assert.equal(calls,0);
 });
});
