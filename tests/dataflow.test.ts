import "./setup";
import {test} from "node:test";
import assert from "node:assert/strict";
import Requests from "../src/modules/requests";
import API from "../src/modules/api";
import OpenAlex from "../src/modules/openalex";
import {cacheReferences,readCachedReferences} from "../src/modules/referenceCache";
import {retrieveReferenceList} from "../src/modules/referenceRetrieval";
test("DOI parent validation covers Crossref and OpenAlex without losing Semantic Scholar fallback",async()=>{
  const api=new API({} as any);
  api.requests.get=async()=>({message:{DOI:"10.1234/wrong",title:["Wrong parent"],reference:[{"article-title":"Wrong reference"}]}});
  api.openAlex.getWorkByDOI=async()=>undefined;
  api.getDOIReferenceListBySemanticScholar=async()=>({references:[{title:"Correct fallback",identifiers:{}}],source:"SemanticScholar"});
  try{const info=await api.getDOIInfoByCrossref("10.1234/expected");assert.equal(info?.references?.[0].title,"Correct fallback");}
  finally{api.requests.dispose();api.publisherReferences.dispose();}
  const provider=new OpenAlex({get:async()=>({id:"https://openalex.org/W1",doi:"10.1234/wrong"})} as any);
  await assert.rejects(provider.getWorkByDOI("10.1234/expected"),/conflicting DOI/);
});
test("OpenAlex pagination without total count follows cursors and remains partial",async()=>{
  let pages=0;
  const provider=new OpenAlex({get:async(url:string)=>url.includes("/works/doi:")?{id:"https://openalex.org/W1",doi:"10.1234/origin"}:
    {results:[{id:`https://openalex.org/W${++pages+1}`,title:"Citation"}],meta:pages===1?{next_cursor:"next"}:{}}} as any);
  const result=await provider.getNeighborhood("10.1234/origin","Citations");assert.equal(pages,2);assert.equal(result.references.length,2);assert.equal(result.truncated,true);
});

test("force refresh does not reuse old flights or accept their late cache writes",async()=>{
  const original=Zotero.HTTP.request,client=new Requests();let release:any,calls=0;
  Zotero.HTTP.request=async()=>++calls===1?new Promise(resolve=>{release=resolve;}):{status:200,response:{generation:"new"}};
  try {
    const old=client.get("https://api.test/epoch");client.clearCache();
    assert.deepEqual(await client.get("https://api.test/epoch"),{generation:"new"});
    release({status:200,response:{generation:"old"}});assert.deepEqual(await old,{generation:"old"});
    assert.deepEqual(await client.get("https://api.test/epoch"),{generation:"new"});assert.equal(calls,2);
  }finally{client.dispose();Zotero.HTTP.request=original;}
});
test("reference cache owns nested metadata and excludes live Zotero objects",()=>{
  const item:any={};item.cycle=item;
  const reference:any={title:"Cache ownership fixture",text:"Cache ownership fixture",authors:["Author"],identifiers:{DOI:"10.1234/cache"},sources:["SemanticScholar"],retraction:{isRetracted:true},_item:item};
  const cached=cacheReferences([reference],"signature",1000);reference.authors.push("Changed");reference.identifiers.DOI="10.1234/changed";
  const first=readCachedReferences(cached,"signature",1000,1100)!;first[0].authors!.push("Later");first[0].identifiers.DOI="10.1234/later";
  const second=readCachedReferences(cached,"signature",1000,1100)!;
  assert.deepEqual(second[0].authors,["Author"]);assert.equal(second[0].identifiers.DOI,"10.1234/cache");assert.equal(second[0]._item,undefined);
});
test("reference failure and legal empty results are distinct",async()=>{
  assert.equal((await retrieveReferenceList([{name:"Offline",run:async()=>undefined}])).status,"unavailable");
  assert.equal((await retrieveReferenceList([{name:"Empty",run:async()=>({references:[],source:"Empty"})}])).status,"empty");
});
test("CNKI cancels authentication before token persistence and dependent requests",async()=>{
  const api=new API({isChinese:()=>true} as any),controller=new AbortController();const get=Zotero.Prefs.get,set=Zotero.Prefs.set;let writes=0,requests=0;
  Zotero.Prefs.get=((key:string)=>key.endsWith("token")?"":"fixture") as any;Zotero.Prefs.set=(()=>writes++) as any;
  api.requests.post=async(_url,_body,_type,_headers,signal)=>{assert.equal(signal,controller.signal);controller.abort();return {Content:"late-token"};};
  api.requests.get=async()=>{requests++;};
  try {assert.equal(await api.getCNKIFileInfo("中文&filename",0,controller.signal),undefined);assert.equal(writes,0);assert.equal(requests,0);}
  finally{api.requests.dispose();api.publisherReferences.dispose();Zotero.Prefs.get=get;Zotero.Prefs.set=set;}
});
test("CNKI unknown failures do not loop login; first-page lists remain partial",async()=>{
  const api=new API({} as any),get=Zotero.Prefs.get;let logins=0;Zotero.Prefs.get=(()=>"fixture") as any;
  api.requests.post=async()=>{logins++;return {Content:"fixture"};};
  api.requests.get=async(url:string)=>{assert.ok(!url.includes("filename=a&b"));return {code:500};};
  try{
    assert.equal(await api.getCNKIFileInfo("a&b"),undefined);assert.equal(logins,0);
    api.requests.get=async()=>({code:200,content:{refer:[{title:"中文参考文献",citationNumber:1}]}});
    const info=await api.getCNKIFileInfo("a&b");assert.equal(info?.references?.length,1);assert.equal(info?.referencePartial,true);
  }finally{api.requests.dispose();api.publisherReferences.dispose();Zotero.Prefs.get=get;}
});
