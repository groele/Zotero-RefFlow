import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import PDF from "../src/modules/pdf";
import { textItemsToLines } from "../src/modules/pdfLayout";
import { extractReferencesFromLines } from "../src/modules/referenceExtractor";

const text=(str:string,x:number,y:number,width=160)=>({str,width,height:10,transform:[10,0,0,10,x,y]});
const attachment=()=>({id:1,attachmentContentType:"application/pdf",getAttachmentLastPageIndex:()=>0} as any);
const installSDT=(getPageBlocks:()=>any)=>{
  const host:any=Zotero,original=host.SDT;
  host.SDT={getReader:async()=>({header:{schemaVersion:"1.2.0"},getCatalog:async()=>({pages:[{viewRect:[0,0,612,792]}]}),getPageBlocks})};
  return ()=>{host.SDT=original;};
};
const parser=new PDF({refText2Info:(text:string)=>({title:text,identifiers:{}})} as any);

test("two-column continuations retain sequential citation order",()=>{
  const items=[text('References',40,750)];
  for(const [x,offset] of [[40,0],[330,3]])for(let i=0;i<3;i++)items.push(text(`[${offset+i+1}] Smith, J. Column title.`,x,720-i*40),text(`Journal A, 2024. DOI 10.1234/ref${offset+i+1}`,x,705-i*40));
  const refs=extractReferencesFromLines(textItemsToLines(items,1));
  assert.deepEqual(refs.map(ref=>ref.number),[1,2,3,4,5,6]);
  for(let i=0;i<refs.length;i++)assert.ok(refs[i].text.includes(`10.1234/ref${i+1}`));
});

test("glyph fragments within words are joined without inventing spaces",()=>{
  const lines=textItemsToLines([text('Ref',40,700,15),text('erences',55,700,35)],1);
  assert.equal(lines[0].text,'References');
});
test("a reference heading in the right column does not move before left-column citations",()=>{
 const items=[text('[1] Smith, J. Left title. Journal, 2024.',40,740),text('[2] Brown, A. Left title. Journal, 2023.',40,700),text('References',330,760),text('[3] Lee, K. Right title. Journal, 2022.',330,740),text('[4] Doe, B. Right title. Journal, 2021.',330,700)];
 const lines=textItemsToLines(items,1);assert.ok(lines.findIndex(line=>line.text.startsWith('[2]'))<lines.findIndex(line=>line.text==='References'));
});

test("PDF deadlines cover a stalled text-content promise",async()=>{
  const restore=installSDT(()=>new Promise(()=>{}));
  try{await assert.rejects(parser.getReferences(attachment(),false,{timeoutMs:20,notify:false}),{name:'TimeoutError'});}finally{restore();}
});

test("PDF cancellation settles a pending read and closes its timer",async()=>{
  const controller=new AbortController();
  const restore=installSDT(()=>new Promise(()=>{}));
  try{const job=parser.getReferences(attachment(),false,{signal:controller.signal,timeoutMs:10000,notify:false});controller.abort();await assert.rejects(job,{name:'AbortError'});}finally{restore();}
});

test("deleted attachments stop before accessing native structured text",async()=>{
  const closed=attachment();closed.deleted=true;
  await assert.rejects(parser.getReferences(closed,false,{notify:false}),{name:'AbortError'});
});
