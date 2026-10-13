import "./setup";
import {test} from "node:test";
import assert from "node:assert/strict";
import SemanticScholar from "../src/modules/semanticScholar";
const paper=(id:string)=>({paperId:id,title:`Reference fixture ${id}`,authors:[{name:"Fixture Author"}],year:2024,externalIds:{DOI:`10.1234/${id}`}});

test("Semantic Scholar DOI path uses official API, encoded identifier and immutable metadata",async()=>{
  const original=Zotero.Prefs.get;let called="",headers:any;const response=paper("origin");delete (response.externalIds as any).DOI;
  Zotero.Prefs.get=(()=>"fixture-test-key") as any;
  try {
    const provider=new SemanticScholar({get:async(url:string,_type:string,h:any)=>{called=url;headers=h;return response;}} as any);
    const result=await provider.byDOI("https://doi.org/10.1234/origin");
    assert.ok(called.startsWith("https://api.semanticscholar.org/graph/v1/paper/DOI:10.1234%2Forigin?"));
    assert.equal(headers["x-api-key"],"fixture-test-key");assert.equal(result.externalIds.DOI,"10.1234/origin");
    assert.equal(response.externalIds.DOI,undefined);
  }finally{Zotero.Prefs.get=original;}
});
test("Semantic Scholar rejects a conflicting returned DOI",async()=>{
  await assert.rejects(new SemanticScholar({get:async()=>paper("other")} as any).byDOI("10.1234/origin"),/conflicting DOI/);
});
test("Semantic Scholar title lookup checks candidates rather than returning the first hit",async()=>{
  const expected={...paper("match"),title:"Quantum optical response in layered semiconductors"};
  const provider=new SemanticScholar({get:async()=>({data:[{...paper("wrong"),title:"Protein signaling in bacteria"},expected]})} as any);
  assert.equal((await provider.byTitle(expected.title))?.paperId,"match");
});
test("Semantic Scholar does not resolve an ambiguous exact title to conflicting DOIs",async()=>{
  const title="Quantum optical response in layered semiconductors";
  const provider=new SemanticScholar({get:async()=>({data:[{...paper("version-a"),title},{...paper("version-b"),title}]})} as any);
  assert.equal(await provider.byTitle(title),undefined);
});
test("Semantic Scholar references follow offsets, use citedPaper and expose missing records",async()=>{
  const urls:string[]=[];
  const provider=new SemanticScholar({get:async(url:string)=>{urls.push(url);return urls.length===1?{data:[{citedPaper:paper("one")},{citedPaper:null}],next:100}:{data:[{citedPaper:paper("two")}]} ;}} as any);
  const result=await provider.neighborhood("10.1234/origin","References");
  assert.equal(urls.length,2);assert.match(urls[1],/offset=100$/);
  assert.deepEqual(result?.references.map(ref=>ref.identifiers.paperID),["one","two"]);
  assert.equal(result?.partial,true);assert.ok(result?.references.every(ref=>ref.number===undefined));
});
test("Semantic Scholar citations use citingPaper and remain separate from references",async()=>{
  const result=await new SemanticScholar({get:async(url:string)=>{
    assert.match(url,/\/citations\?/);return {data:[{citedPaper:paper("wrong"),citingPaper:paper("correct")}]};
  }} as any).neighborhood("10.1234/origin","Citations");
  assert.equal(result?.references[0].identifiers.paperID,"correct");assert.equal(result?.partial,false);
});
test("Semantic Scholar record budget and cyclic cursor are reported as partial",async()=>{
  let calls=0;
  const provider=new SemanticScholar({get:async()=>{calls++;return {data:[{citedPaper:paper("one")},{citedPaper:paper("two")}],next:100};}} as any);
  const result=await provider.neighborhood("10.1234/origin","References",undefined,1);
  assert.equal(result?.references.length,1);assert.equal(result?.partial,true);assert.equal(calls,1);
  const cyclic=await new SemanticScholar({get:async()=>({data:[{citedPaper:paper("one")}],next:0})} as any).neighborhood("10.1234/origin","References");
  assert.equal(cyclic?.partial,true);
});
test("Semantic Scholar cancellation settles an uncooperative provider and blocks later pages",async()=>{
  const controller=new AbortController();let calls=0;
  const provider=new SemanticScholar({get:async()=>{calls++;return new Promise(()=>{});}} as any);
  const pending=provider.neighborhood("10.1234/origin","References",controller.signal);await Promise.resolve();controller.abort();
  await assert.rejects(pending,{name:"AbortError"});assert.equal(calls,1);
});
