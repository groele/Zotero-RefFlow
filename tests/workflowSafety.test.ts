import "./setup";
import {test} from "node:test";
import assert from "node:assert/strict";
import Views from "../src/modules/views";
import ReferenceCards from "../src/modules/referenceCards";

test("cancel visibility follows the current item and concurrent fetch",()=>{
 const views:any=Object.create(Views.prototype),cancel={hidden:true};let item="1",busy=false;
 views.pendingImports=new WeakMap();
 const body:any={querySelector:()=>cancel,getAttribute:()=>item,hasAttribute:()=>busy};
 views.pendingImports.set(body,new Map([[1,1]]));
 views.syncCancelButton(body);assert.equal(cancel.hidden,false);
 item="2";views.syncCancelButton(body);assert.equal(cancel.hidden,true);
 busy=true;views.syncCancelButton(body);assert.equal(cancel.hidden,false);
 busy=false;item="1";views.syncCancelButton(body);assert.equal(cancel.hidden,false);
 views.pendingImports.get(body).delete(1);views.syncCancelButton(body);assert.equal(cancel.hidden,true);
});

test("settings selected import never silently expands to filtered references",async()=>{
 const cards:any=Object.create(ReferenceCards.prototype);
 Object.assign(cards,{disposed:false,body:{isConnected:true},parent:()=>({id:1}),refs:[{title:"A"}],selected:new Set(),subset:()=>[{title:"A"}]});
 await assert.rejects(cards.runSettingsAction("import-selected"));
});


test("import errors redact credential-bearing diagnostics before display",async()=>{
 const {importErrorText,importFailureText}=await import("../src/modules/importErrors");
 for(const value of [importErrorText(new Error('token=private https://host.test/?key=private')),importFailureText({reason:'password=private'})]) assert.equal(value.includes('private'),false);
});
