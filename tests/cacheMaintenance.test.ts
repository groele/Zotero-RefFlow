import "./setup";
import {test} from "node:test";
import assert from "node:assert/strict";
import LocalStorage from "../src/modules/localStorage";
import CacheMaintenance, {cacheLimits,referenceSnapshotExpired} from "../src/modules/cacheMaintenance";

test("retention cleanup separates PDF, neighborhood, partial, empty and permanent snapshots",()=>{
  const original=Zotero.Prefs.get;
  const settings:Record<string,number>={referenceDays:30,pdfDays:60,neighborhoodDays:7,partialMinutes:15};
  Zotero.Prefs.get=((key:string)=>settings[key.replace("refflow.","")]) as typeof original;
  const now=100*86400000;
  const snapshot=(age:number,status="success")=>({schema:4,savedAt:now-age,snapshot:{status}});
  try{
    assert.equal(referenceSnapshotExpired("References-API",snapshot(31*86400000),now),true);
    assert.equal(referenceSnapshotExpired("References-PDF",snapshot(31*86400000),now),false);
    assert.equal(referenceSnapshotExpired("References-API-Citations",snapshot(8*86400000),now),true);
    assert.equal(referenceSnapshotExpired("References-API",snapshot(16*60000,"empty"),now),true);
    assert.equal(referenceSnapshotExpired("References-API",{...snapshot(16*60000),snapshot:{truncated:true}},now),true);
    settings.referenceDays=0;
    assert.equal(referenceSnapshotExpired("References-API",snapshot(99*86400000),now),false);
    assert.equal(referenceSnapshotExpired("References-API",{schema:3,savedAt:now},now),true);
    assert.equal(referenceSnapshotExpired("References-API",{schema:4,savedAt:now+1},now),true);
    assert.equal(referenceSnapshotExpired("user-setting",{anything:true},now),false);
    settings.cacheMaxMiB=0;settings.cacheMaxItems=10001;
    assert.deepEqual(cacheLimits(),{maxBytes:8*1048576,maxItems:250});
  }finally{Zotero.Prefs.get=original;}
});

test("startup prunes expired lists before capacity eviction and saves readable JSON",async()=>{
  const read=Zotero.File.getContentsAsync,write=Zotero.File.putContentsAsync;
  let persisted="";
  Zotero.File.getContentsAsync=async()=>JSON.stringify({"1:FRESH":{list:{fresh:true}},"1:OLD":{list:{fresh:false}}});
  Zotero.File.putContentsAsync=async(_file,content)=>{persisted=String(content);};
  const store=new LocalStorage("startup-cleanup",{maxItems:1},(_key,value)=>!value.fresh);
  try{
    await store.lock.promise;
    assert.equal(store.get({key:"FRESH",libraryID:1},"list").fresh,true);
    assert.equal(store.metrics.evictions,0);assert.equal(store.metrics.expired,1);
    await store.flush();
    assert.match(persisted,/\n  "1:FRESH": \{\n    "list":/);
    assert.equal(Buffer.byteLength(persisted),store.cacheUsage.bytes);
    assert.ok(store.cacheUsage.bytes<=store.cacheUsage.maxBytes);
  }finally{await store.dispose();Zotero.File.getContentsAsync=read;Zotero.File.putContentsAsync=write;}
});

test("lowering limits preserves recent papers and usage subscriptions stop on release",async()=>{
  const store=new LocalStorage("resized-cache",{maxItems:1000,maxBytes:2*1048576});
  let updates=0;const unsubscribe=store.subscribe(()=>updates++);
  try{
    for(let i=0;i<1000;i++)await store.set({key:"K"+i,libraryID:1},"list",{text:"中文".repeat(20)});
    store.get({key:"K0",libraryID:1},"list");
    await store.maintain({maxItems:250});
    assert.equal(store.cacheUsage.items,250);assert.equal(store.metrics.evictions,750);
    assert.ok(store.get({key:"K0",libraryID:1},"list"));
    await store.maintain({maxBytes:4096});
    assert.ok(store.cacheUsage.bytes<=4096);
    assert.ok(updates>0);unsubscribe();const before=updates;
    await store.set({key:"FINAL",libraryID:1},"list",1);assert.equal(updates,before);
  }finally{await store.dispose();}
});

test("maintenance observes changes, runs while caching is disabled and stops on shutdown",async()=>{
  const prefs=Zotero.Prefs as any,original={get:prefs.get,registerObserver:prefs.registerObserver,unregisterObserver:prefs.unregisterObserver};
  const interval=globalThis.setInterval,clear=globalThis.clearInterval;
  const observers=new Map<symbol,()=>void>();let tick=()=>{},cleared=false;
  prefs.get=(key:string)=>key==="refflow.cacheEnabled"?false:undefined;
  prefs.registerObserver=(_key:string,callback:()=>void)=>{const id=Symbol();observers.set(id,callback);return id;};
  prefs.unregisterObserver=(id:symbol)=>observers.delete(id);
  globalThis.setInterval=((callback:()=>void)=>{tick=callback;return 1;}) as any;
  globalThis.clearInterval=(()=>{cleared=true;}) as any;
  let expired=false;
  const store=new LocalStorage("maintenance-lifecycle",{},()=>expired);
  const maintenance=new CacheMaintenance(store);
  try{
    await store.set({key:"A",libraryID:1},"list",1);expired=true;tick();
    await store.lock.promise;
    assert.equal(store.cacheUsage.items,0);
    assert.equal(observers.size,6);
    maintenance.dispose();assert.equal(observers.size,0);assert.equal(cleared,true);
    await store.set({key:"A",libraryID:1},"other",1);const removed=store.metrics.expired;
    tick();await store.lock.promise;assert.equal(store.metrics.expired,removed);
  }finally{maintenance.dispose();await store.dispose();Object.assign(prefs,original);globalThis.setInterval=interval;globalThis.clearInterval=clear;}
});
