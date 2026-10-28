import "./setup";
import {test} from "node:test";
import assert from "node:assert/strict";
import {renderReferenceSourceDetails, safeProviderAttempt} from "../src/modules/referenceSourceDetails";

function element(doc:any){return {ownerDocument:doc,children:[] as any[],dataset:{} as Record<string,string>,textContent:"",hidden:false,className:"",querySelector(selector:string){return this.children.find((child:any)=>child.tagName===selector)||null;},replaceChildren(...children:any[]){this.children=children;},append(...children:any[]){for(const child of children){child.remove=()=>{this.children=this.children.filter((value:any)=>value!==child);};this.children.push(child);}}};}
function fixture(){const doc:any={createElement:(tag:string)=>Object.assign(element(doc),{tagName:tag})};return {doc,details:element(doc)};}

test("source details expose the selected partial result and attempts as text",()=>{
 const {details}=fixture();
 renderReferenceSourceDetails(details as any,{source:"OpenAlex",count:8,expected:12,partial:true,retained:true,attempts:["PDF: 5 (partial)","OpenAlex: 8 (partial)"]},(key,args)=>`${key} ${args?JSON.stringify(args):""}`);
 assert.equal(details.hidden,false);
 assert.equal(details.dataset.status,"partial");
 assert.equal(details.children[0].tagName,"summary");
 assert.match(details.children[1].textContent,/OpenAlex/);
 assert.match(details.children[2].textContent,/8/);
 assert.match(details.children[2].textContent,/12/);
 assert.equal(details.children[4].children.length,2);
});

test("empty and unavailable outcomes stay distinct from complete reference lists",()=>{
 const {details}=fixture();
 renderReferenceSourceDetails(details as any,{source:"Online",count:0,partial:false,status:"empty"},key=>key);
 assert.equal(details.dataset.status,"empty");
 assert.equal(details.children[2].textContent.includes("cards-source-empty"),true);
 renderReferenceSourceDetails(details as any,{source:"Crossref",count:8,expected:12,partial:true,retained:true,latestAttempt:{source:"Auto",count:0,partial:true},status:"partial",attempts:["Crossref: timeout"]},key=>key);
 assert.equal(details.dataset.status,"partial");
 assert.equal(details.dataset.latestStatus,"unavailable");
 assert.equal(details.children.some((child:any)=>child.textContent.includes("cards-source-latest-unavailable")),true);
});

test("provider diagnostics redact URLs and credential values and truncate long errors",()=>{
 const safe=safeProviderAttempt("Online: https://api.example.test/v1?api_key=private Authorization=secret <img src=x>");
 assert.equal(safe.includes("https://"),false);
 assert.equal(safe.includes("private"),false);
 assert.equal(safe.includes("secret"),false);
 assert.match(safe,/<img src=x>/);
 assert.equal(safeProviderAttempt("x".repeat(300)).length,240);
});


test("refresh keeps the focused disclosure summary node and expansion state",()=>{
 const {details}=fixture();
 const evidence={source:"Crossref",count:2,partial:false};
 renderReferenceSourceDetails(details as any,evidence,key=>key);
 const summary=details.children[0];
 (details as any).open=true;
 renderReferenceSourceDetails(details as any,{...evidence,count:3},key=>key);
 assert.equal(details.children[0],summary);
 assert.equal((details as any).open,true);
 assert.equal(details.children.filter((child:any)=>child.tagName==="summary").length,1);
});

test("quoted credential diagnostics and local Windows paths are hidden",()=>{
 for(const input of ['{"api_key": "private-key"}', "'access_token': 'private-key'", 'Bearer private-key', String.raw`Read C:\Users\Private\paper.pdf`]) {
  const safe=safeProviderAttempt(input);
  assert.equal(/private-key|Private|paper.pdf/.test(safe),false,safe);
 }
});
