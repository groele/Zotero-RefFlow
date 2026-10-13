import "./setup";
import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {structuredPageToLines} from "../src/modules/structuredPDF";
import {extractReferencesFromLines} from "../src/modules/referenceExtractor";

for(const [name,count] of [["single",4],["columns",6],["author-year",3],["numbered-prose",0],["large",12]] as const) {
  test(`captured Zotero SDT ${name} preserves bibliography extraction`,()=>{
    const pack=JSON.parse(fs.readFileSync(path.resolve(`tests/native-fixtures/sdt-${name}.json`),"utf8"));
    const lines=pack.catalog.pages.flatMap((page:any,index:number)=>structuredPageToLines(pack.content,index,page.viewRect));
    const refs=extractReferencesFromLines(lines);
    assert.equal(refs.length,count,JSON.stringify({lines,refs}));
    if(name==="columns") {
      assert.deepEqual(refs.map(ref=>ref.number),[1,2,3,4,5,6]);
      refs.forEach((ref,index)=>assert.match(ref.text,new RegExp(`10\\.1234/fixture${index+1}`)));
    }
  });
}
test("SDT glyph runs preserve supplementary Unicode and do not cross page boundaries",()=>{
  const blocks=[{text:"A𝛼 B",anchor:{textMap:JSON.stringify([[0,0,40,700,50,710,5,5],[0,1,40,700,50,710,[3,5]]])}}];
  assert.equal(structuredPageToLines(blocks,0,[0,0,612,792])[0].text,"A𝛼");
  assert.equal(structuredPageToLines(blocks,1,[0,0,612,792])[0].text,"B");
});
