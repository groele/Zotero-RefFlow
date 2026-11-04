import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import Views from "../src/modules/views";

test("reader PDF selection rejects deleted or missing files without switching documents", async () => {
  const z:any=Zotero, oldGet=z.Items.get, oldFile=z.File.pathToFile;
  const parent:any={id:1,getBestAttachment:async()=>{throw new Error("must not switch PDF");}};
  let attachment:any={id:2,parentID:1,attachmentContentType:"application/pdf",deleted:true,getFilePathAsync:async()=>"missing.pdf"};
  z.Items.get=()=>attachment; z.File.pathToFile=()=>({exists:()=>false});
  const views:any=Object.create(Views.prototype);
  try {
    assert.equal(await views.pdfAttachment(parent,{itemID:2}),undefined);
    attachment={...attachment,deleted:false};
    assert.equal(await views.pdfAttachment(parent,{itemID:2}),undefined);
    z.File.pathToFile=()=>({exists:()=>true});
    assert.equal(await views.pdfAttachment(parent,{itemID:2}),attachment);
  } finally {z.Items.get=oldGet;z.File.pathToFile=oldFile;}
});
