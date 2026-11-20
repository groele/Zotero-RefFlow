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

test("automatic PDF selection continues after an unreadable file", async () => {
  const z: any = Zotero;
  const get = z.Items.getAsync, file = z.File.pathToFile;
  const good = { attachmentContentType: "application/pdf", getField: () => "", getFilePathAsync: async () => "paper.pdf" };
  const bad = { ...good, getFilePathAsync: async () => { throw new Error("storage unavailable"); } };
  try {
    z.Items.getAsync = async () => [bad, good];
    z.File.pathToFile = () => ({ exists: () => true });
    const parent: any = { getBestAttachment: async () => bad, getAttachments: () => [1, 2] };
    assert.equal(await Object.create(Views.prototype).pdfAttachment(parent), good);
  } finally { z.Items.getAsync = get; z.File.pathToFile = file; }
});
