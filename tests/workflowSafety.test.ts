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


test("settings action resolves the active PDF parent and loads the list on demand",async()=>{
 const z:any=Zotero,oldWindow=z.getMainWindow,oldItems=z.Items,oldAddon=(globalThis as any).addon;(globalThis as any).addon={data:{locale:{current:{formatMessagesSync:([x]:any)=>[{value:x.id}]}}}};const parent:any={id:11,isRegularItem:()=>true,getField:()=>"fixture"};const attachment:any={id:12,parentItem:parent};
 const context:any={contains:()=>true};const win:any={document:{getElementById:()=>context},ZoteroPane:{getSelectedItems:()=>[]}};const body:any={isConnected:true,ownerDocument:{defaultView:win},getAttribute:(key:string)=>key==='data-refflow-item-id'?'11':null,references:[],_cards:{runSettingsAction:async(action:string)=>action}};
 const views:any=Object.create(Views.prototype);views.utils={getReader:()=>({itemID:12})};views.panes=new Set([body]);views.refreshReferences=async()=>{body.references=[{title:'loaded'}]};z.getMainWindow=()=>win;z.Items={get:(id:number)=>id===12?attachment:undefined};
 try{assert.ok(await views.runSettingsAction('copy-text'));assert.equal(body.references.length,1);}finally{z.getMainWindow=oldWindow;z.Items=oldItems;(globalThis as any).addon=oldAddon;}
});

test("settings action refuses a stale item after an asynchronous load",async()=>{
 const z:any=Zotero,old=z.getMainWindow;const parent:any={id:11,isRegularItem:()=>true};let current:any=parent,executed=false;
 const win:any={ZoteroPane:{getSelectedItems:()=>[current]}};const body:any={isConnected:true,ownerDocument:{defaultView:win},getAttribute:()=>"11",references:[],_cards:{runSettingsAction:async()=>{executed=true;}}};
 const views:any=Object.create(Views.prototype);views.utils={getReader:()=>undefined};views.panes=new Set([body]);views.refreshReferences=async()=>{body.references=[{}];current={id:22};};z.getMainWindow=()=>win;
 try{await assert.rejects(views.runSettingsAction('import-all'));assert.equal(executed,false);}finally{z.getMainWindow=old;}
});
