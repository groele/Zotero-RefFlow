import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import API from "../src/modules/api";
import OpenAlex from "../src/modules/openalex";
import SemanticScholar from "../src/modules/semanticScholar";
import {selectUniqueTitle} from "../src/modules/titleResolution";
import {normalizeReferenceResult,retrieveReferenceList,referenceGaps} from "../src/modules/referenceRetrieval";
import {cacheReferenceResult,readCachedReferenceResult,readCachedReferences,preferCachedReferences} from "../src/modules/referenceCache";

const title="Quantum optical response in layered semiconductors";
const ref=(number?:number):ItemBaseInfo=>({title,authors:["Alice Smith"],identifiers:{DOI:"10.1234/fixture"},number});
const oa=(id:string,doi=id)=>({id:`https://openalex.org/${id}`,doi:`10.1234/${doi}`,title,authorships:[{author:{display_name:"Alice Smith"}}],publication_year:2024});
const s2=(id:string)=>({paperId:id,title,authors:[{name:"Alice Smith"}],year:2024,externalIds:{DOI:`10.1234/${id}`}});
const cr=(id:string)=>({DOI:`10.1234/${id}`,title:[title],author:[{given:"Alice",family:"Smith"}],published:{'date-parts':[[2024]]}});
function close(api:API){api.requests.dispose();api.publisherReferences.dispose();}

test("partial status alone must continue fallback rather than masquerade as a complete list",async()=>{
  const result=await retrieveReferenceList([{name:"Index",run:async()=>({references:[ref()],source:"Index",status:"partial"})},
    {name:"PDF",run:async()=>({references:[ref()],source:"PDF"})}]);
  assert.equal(result.source,"PDF");assert.equal(result.partial,false);assert.equal(result.attempts?.length,2);
});
test("zero usable partial records are unavailable, including after a legal empty fallback",async()=>{
  const result=await retrieveReferenceList([{name:"Lost",run:async()=>({references:[],source:"Lost",partial:true})},
    {name:"Empty",run:async()=>({references:[],source:"Empty"})}]);
  assert.equal(result.status,"unavailable");assert.equal((await retrieveReferenceList([])).status,"unavailable");
});
test("a corrupt row cannot erase usable rows or preserve a false complete status",async()=>{
  const cyclic:any={title};cyclic.self=cyclic;
  const result=await retrieveReferenceList([{name:"Provider",run:async()=>({references:[ref(),null,{},cyclic] as any,source:"Provider",status:"success"})}]);
  assert.equal(result.references.length,1);assert.equal(result.status,"partial");assert.equal(result.partial,true);
});
test("mixed, invalid and single continuation numbers remain incomplete",()=>{
  assert.equal(referenceGaps([ref(1),ref()]),true);assert.equal(referenceGaps([ref(51)]),true);
  assert.equal(referenceGaps([ref(),ref()]),false);
  const result=normalizeReferenceResult({references:[ref(-1)],source:"PDF"});
  assert.equal(result.partial,true);assert.equal(result.references[0].number,undefined);
});
test("result normalization preserves ownership and rejects malformed expected counts",()=>{
  const row=ref();const result=normalizeReferenceResult({references:[row],source:"",expected:NaN});
  row.authors.push("Changed");assert.deepEqual(result.references[0].authors,["Alice Smith"]);
  assert.equal(result.expected,undefined);assert.equal(result.source,"Online");
  assert.equal(normalizeReferenceResult({references:[ref()],source:"Provider",expected:2}).status,"partial");
});
test("cache roundtrip retains completeness and applies short TTL even to status-only partial snapshots",()=>{
  const record=cacheReferenceResult({references:[ref()],source:"SemanticScholar",status:"partial",expected:3},"v5",1000);
  const restored=readCachedReferenceResult(record,"v5",1100)!;
  assert.equal(restored.status,"partial");assert.equal(restored.expected,3);assert.equal(restored.source,"SemanticScholar");
  restored.references[0].identifiers.DOI="10.1234/mutation";
  assert.equal(readCachedReferenceResult(record,"v5",1100)?.references[0].identifiers.DOI,"10.1234/fixture");
  assert.equal(readCachedReferenceResult({...record,snapshot:{source:"Index",status:"partial"}},"v5",1000+16*60*1000),undefined);
  assert.equal(readCachedReferenceResult(record,"v4",1100),undefined);
});
test("corrupt cache reads are misses rather than uncaught serialization exceptions",()=>{
  const cyclic:any={title};cyclic.self=cyclic;
  assert.equal(readCachedReferences({schema:3,signature:"sig",savedAt:1000,references:[cyclic]},"sig",1000,1100),undefined);
});
test("offline cache selection preserves source evidence without contaminating persisted presentation",()=>{
  const previous=readCachedReferenceResult(cacheReferenceResult({references:[ref()],source:"PDF",partial:true},"sig",1000),"sig",1100)!;
  const result=preferCachedReferences({references:[],source:"Online",status:"unavailable",attempts:["HTTP 429"]},previous,"Offline");
  assert.equal(result.source,"PDF · Offline");assert.equal(result.status,"partial");assert.equal(previous.source,"PDF");
  assert.deepEqual(result.attempts,["HTTP 429"]);
});
test("title selection rejects conflicting identities regardless of ordering and collapses the same DOI",()=>{
  const a={value:"A",id:"A",work:{title,doi:"10.1234/a"}},b={value:"B",id:"B",work:{title,doi:"10.1234/b"}};
  assert.equal(selectUniqueTitle({title},[a,b]),undefined);assert.equal(selectUniqueTitle({title},[b,a]),undefined);
  assert.equal(selectUniqueTitle({title},[a,{...b,work:{title,doi:"https://doi.org/10.1234/A"}}]),"A");
});
test("title identity aliases handle missing DOI on duplicates but reject unrelated records",()=>{
  const a={value:"A",id:"same",work:{title,doi:"10.1234/a"}};
  assert.equal(selectUniqueTitle({title},[a,{value:"duplicate",id:"same",work:{title}}]),"A");
  assert.equal(selectUniqueTitle({title},[a,{value:"unknown",id:"other",work:{title}}]),undefined);
});
test("supplied author and year must be corroborated, including missing candidate fields",()=>{
  const candidate={value:"A",id:"A",work:{title,authors:["Alice Smith"],year:2024}};
  assert.equal(selectUniqueTitle({title,author:"Jones"},[candidate]),undefined);
  assert.equal(selectUniqueTitle({title,author:"Smith"},[{...candidate,work:{title,year:2024}}]),undefined);
  assert.equal(selectUniqueTitle({title,year:"2024"},[{...candidate,work:{title,authors:["Smith"]}}]),undefined);
  assert.equal(selectUniqueTitle({title,author:"Smith",year:"2025-01-01"},[candidate]),"A");
});
test("Crossref title lookup rejects ambiguity and accepts one exact title without optional hints",async()=>{
  const api=new API({} as any);
  try{api.requests.get=async()=>({message:{items:[cr("a"),cr("b")]}});assert.equal(await api.getTitleInfoByCrossref(title,"Smith","2024"),undefined);
    api.requests.get=async()=>({message:{items:[null,{title:["Unrelated title"]},cr("unique")]}});
    assert.equal((await api.getTitleInfoByCrossref(title))?.identifiers.DOI,"10.1234/unique");
  }finally{close(api);}
});
test("OpenAlex title lookup shares ambiguity rules and tolerates malformed author arrays",async()=>{
  const ambiguous=new OpenAlex({get:async()=>({results:[oa("W1"),oa("W2")]})} as any);
  assert.equal(await ambiguous.searchWorkByTitle(title,"Smith","2024"),undefined);
  const provider=new OpenAlex({get:async()=>({results:[null,{...oa("W1"),authorships:{invalid:true}}]})} as any);
  assert.equal((await provider.searchWorkByTitle(title))?.doi,"10.1234/w1");
  assert.equal(await provider.searchWorkByTitle(title,"Smith"),undefined);
});
test("Semantic Scholar tolerates malformed search and neighborhood rows without abandoning good evidence",async()=>{
  const provider=new SemanticScholar({get:async(url:string)=>url.includes('/search?')?
    {data:[null,{...s2("good"),authors:[null,{name:"Alice Smith"}]}]}:
    {data:[null,{citedPaper:s2("good")}]} } as any);
  assert.equal((await provider.byTitle(title))?.paperId,"good");
  const result=await provider.neighborhood("10.1234/parent","References");assert.equal(result?.references.length,1);assert.equal(result?.partial,true);
  assert.equal(await new SemanticScholar({get:async()=>({data:{invalid:true}})} as any).byTitle(title),undefined);
});
test("DOI resolver reaches Semantic Scholar after earlier lookup errors",async()=>{
  const api=new API({} as any);const calls:string[]=[];
  api.getTitleInfoByCrossref=async()=>{calls.push("Crossref");throw new Error("HTTP 503");};
  api.openAlex.searchWorkByTitle=async()=>{calls.push("OpenAlex");return;};
  api.semanticScholar.byTitle=async()=>{calls.push("SemanticScholar");return s2("fallback");};
  try{const result=await api.resolveWork(title);assert.equal(result?.doi,"10.1234/fallback");assert.equal(result?.info?.source,"semanticscholar");
    assert.deepEqual(calls,["Crossref","OpenAlex","SemanticScholar"]);
  }finally{close(api);}
});
test("DOI resolver cancellation cannot start a later provider or commit a late candidate",async()=>{
  const api=new API({} as any),controller=new AbortController();let later=0;
  api.getTitleInfoByCrossref=async()=>{controller.abort();return {title,identifiers:{DOI:"10.1234/late"}} as any;};
  api.openAlex.searchWorkByTitle=async()=>{later++;return;};api.semanticScholar.byTitle=async()=>{later++;return;};
  try{assert.equal(await api.resolveWork(title,undefined,undefined,controller.signal),undefined);assert.equal(later,0);}finally{close(api);}
});
test("OpenAlex counts validated unique records rather than duplicate rows before ending pagination",async()=>{
  let page=0;const provider=new OpenAlex({get:async(url:string)=>url.includes('/works/doi:')?
    {...oa("W1","parent")}:
    ++page===1?{results:[oa("W2"),oa("W2")],meta:{count:2,next_cursor:"next"}}:
    {results:[oa("W3")],meta:{count:2}}} as any);
  const result=await provider.getNeighborhood("10.1234/parent","Citations");
  assert.equal(page,2);assert.equal(result.references.length,2);assert.equal(result.truncated,false);
});
test("OpenAlex quarantines malformed citation rows and identifies missing related metadata",async()=>{
  const provider=new OpenAlex({get:async(url:string)=>url.includes('/works/doi:')?oa("W1","parent"):
    {results:[null,{id:'https://openalex.org/W3'},{...oa("W2"),authorships:[null,{author:{display_name:42}}]}],meta:{count:3}}} as any);
  const result=await provider.getNeighborhood("10.1234/parent","Citations");
  assert.equal(result.references.length,1);assert.equal(result.truncated,true);assert.deepEqual(result.references[0].authors,[]);
  await assert.rejects(provider.getNeighborhood("10.1234/parent","Related"),/metadata unavailable/);
});
