import "./setup";
import {test} from "node:test";
import assert from "node:assert/strict";
import LocalStorage from "../src/modules/localStorage";

test("paper files load lazily and updating one paper leaves other files untouched",async()=>{
  const first=new LocalStorage("paper-lazy");
  await first.set({key:"SAME",libraryID:1},"value","personal");
  await first.set({key:"SAME",libraryID:2},"value","group");
  await first.dispose();
  const read=Zotero.File.getContentsAsync,write=Zotero.File.putContentsAsync;
  const reads:string[]=[],writes:string[]=[];
  Zotero.File.getContentsAsync=async(path)=>{reads.push(String(path));return read(path);};
  Zotero.File.putContentsAsync=async(path,text)=>{writes.push(String(path));await write(path,text);};
  const store=new LocalStorage("paper-lazy");
  try{
    await store.lock.promise;
    assert.equal(reads.filter(path=>!path.endsWith('/index.json')).length,0);
    assert.equal(await store.getAsync({key:"SAME",libraryID:1},"value"),"personal");
    assert.equal(reads.filter(path=>!path.endsWith('/index.json')).length,1);
    await store.set({key:"SAME",libraryID:1},"value","changed");await store.flush();
    assert.ok(writes.some(path=>path.endsWith('/1/SAME.json')));
    assert.equal(writes.some(path=>path.endsWith('/2/SAME.json')),false);
    assert.equal(await store.getAsync({key:"SAME",libraryID:2},"value"),"group");
  }finally{await store.dispose();Zotero.File.getContentsAsync=read;Zotero.File.putContentsAsync=write;}
});

test("corrupt index recovers paper files and corrupt paper stays isolated",async()=>{
  const first=new LocalStorage("paper-recovery");
  await first.set({key:"A",libraryID:1},"value","A");
  await first.set({key:"B",libraryID:1},"value","B");
  await first.dispose();
  await Zotero.File.putContentsAsync(first.filename,'{broken');
  const rebuilt=new LocalStorage("paper-recovery");
  await rebuilt.lock.promise;
  assert.equal(rebuilt.cacheUsage.items,2);
  assert.equal(await rebuilt.getAsync({key:"B",libraryID:1},"value"),"B");
  await rebuilt.dispose();
  await Zotero.File.putContentsAsync(PathUtils.join(first.directory,'1','A.json'),'{broken');
  const recovered=new LocalStorage("paper-recovery");
  try{
    await recovered.lock.promise;
    assert.equal(recovered.cacheUsage.items,1);
    assert.equal(await recovered.getAsync({key:"B",libraryID:1},"value"),"B");
    assert.equal(await recovered.getAsync({key:"A",libraryID:1},"value"),undefined);
  }finally{await recovered.dispose();}
});

test("failed index write leaves committed paper recoverable and retry preserves another paper",async()=>{
  const first=new LocalStorage("paper-write-retry");
  await first.set({key:"A",libraryID:1},"value","old");
  await first.set({key:"B",libraryID:1},"value","keep");
  await first.flush();
  const write=Zotero.File.putContentsAsync;
  let fail=true;
  Zotero.File.putContentsAsync=async(path,text)=>{
    if(fail && String(path).endsWith('/index.json'))throw Error('Controlled index failure');
    await write(path,text);
  };
  try{
    await first.set({key:"A",libraryID:1},"value","new");
    await assert.rejects(first.flush(),/Controlled index failure/);
    const recovered=new LocalStorage("paper-write-retry");
    await recovered.lock.promise;
    assert.equal(await recovered.getAsync({key:"A",libraryID:1},"value"),"new");
    assert.equal(await recovered.getAsync({key:"B",libraryID:1},"value"),"keep");
    fail=false;await recovered.dispose();await first.flush();
    assert.equal(first.cacheUsage.writeFailed,false);
  }finally{fail=false;await first.dispose();Zotero.File.putContentsAsync=write;}
});

test("concurrent same-paper changes serialize, and legacy collective caches are ignored",async()=>{
  await Zotero.File.putContentsAsync('/mock/zotero/data/paper-concurrent-reference-cache.json',JSON.stringify({'1:OLD':{value:'old'}}));
  const store=new LocalStorage("paper-concurrent");
  const item={key:"SAFE",libraryID:1};
  try{
    await store.lock.promise;assert.equal(store.cacheUsage.items,0);
    await Promise.all([store.set(item,'first',1),store.set(item,'second',2)]);
    assert.equal(await store.getAsync(item,'first'),1);assert.equal(await store.getAsync(item,'second'),2);
    await store.set({key:'../escape',libraryID:1},'value',1);
    assert.equal(store.cacheUsage.items,1);
  }finally{await store.dispose();}
});
