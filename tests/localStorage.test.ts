import "./setup";
import { test, describe } from "node:test";
import assert from "node:assert";
import LocalStorage from "../src/modules/localStorage";

describe("LocalStorage Suite", () => {
  test("missing data directory retains memory without guessing a legacy or temporary path",async()=>{
    const directory=Zotero.DataDirectory.dir;Zotero.DataDirectory.dir="";
    try{const storage=new LocalStorage("no-directory");await storage.set({key:"MEMORY",libraryID:1},"data",1);assert.equal(storage.filename,undefined);assert.equal(storage.get({key:"MEMORY",libraryID:1},"data"),1);await storage.dispose();}finally{Zotero.DataDirectory.dir=directory;}
  });
  test("disposed stores reject late delete and clear operations",async()=>{
    const storage=new LocalStorage("disposed-cache");const item={key:"KEPT",libraryID:1};await storage.set(item,"data",1);await storage.dispose();await storage.delete(item,"data");await storage.clear(item);assert.equal(storage.get(item,"data"),1);
  });
  test("persistent cache evicts old items and keeps recently read entries",async()=>{
    const storage=new LocalStorage("capacity-test");for(let i=0;i<250;i++)await storage.set({key:"K"+i,libraryID:1},"data",i);await storage.getAsync({key:"K0",libraryID:1},"data");await storage.set({key:"K250",libraryID:1},"data",250);assert.equal(Object.keys(storage.cache).length,250);assert.equal(storage.get({key:"K1",libraryID:1},"data"),undefined);assert.equal(storage.get({key:"K0",libraryID:1},"data"),0);await storage.dispose();
  });
  test("shutdown flush saves the latest update before the debounce fires",async()=>{
    const original=Zotero.File.putContentsAsync;let content='';
    Zotero.File.putContentsAsync=async (_file:string,snapshot:string)=>{content=snapshot;};
    try{const storage=new LocalStorage('shutdown-test');await storage.set({key:'FINAL',libraryID:2},'data',{title:'last update'});await storage.dispose();assert.equal(JSON.parse(content)['2:FINAL'].data.title,'last update');}finally{Zotero.File.putContentsAsync=original;}
  });
  test("should prioritize Zotero.DataDirectory.dir over temporary directory", async () => {
    const storage = new LocalStorage("test-cache");
    await storage.lock.promise;
    assert.ok(storage.filename.includes("/mock/zotero/data"), `Expected DataDirectory path, got: ${storage.filename}`);
  });

  test("should get and set cache items correctly", async () => {
    const storage = new LocalStorage("test-cache-kv");
    await storage.lock.promise;

    const mockItem = { key: "ITEMKEY1" };
    await storage.set(mockItem, "References-API", [{ title: "Paper A" }]);

    const cached = storage.get(mockItem, "References-API");
    assert.deepStrictEqual(cached, [{ title: "Paper A" }]);
  });

  test("should isolate items with identical keys in different libraries", async () => {
    const storage = new LocalStorage("test-cache-library-isolation");
    await storage.lock.promise;
    const personalItem = { key: "DUPLICATE", libraryID: 1 };
    const groupItem = { key: "DUPLICATE", libraryID: 42 };

    await storage.set(personalItem, "References-API", [{ title: "Personal" }]);
    await storage.set(groupItem, "References-API", [{ title: "Group" }]);

    assert.deepStrictEqual(await storage.getAsync(personalItem, "References-API"), [{ title: "Personal" }]);
    assert.deepStrictEqual(await storage.getAsync(groupItem, "References-API"), [{ title: "Group" }]);
  });

  test("should flush debounced save cleanly", async () => {
    let savedContent = "";
    const originalPut = (globalThis as any).Zotero.File.putContentsAsync;
    (globalThis as any).Zotero.File.putContentsAsync = async (file: string, content: string) => {
      savedContent = content;
      return true;
    };

    try {
      const storage = new LocalStorage("test-cache-flush");
      await storage.lock.promise;
      const mockItem = { key: "ITEMKEY2" };
      await storage.set(mockItem, "doi", "10.1038/test");
      await storage.flush();

      assert.ok(savedContent.includes("10.1038/test"));
    } finally {
      (globalThis as any).Zotero.File.putContentsAsync = originalPut;
    }
  });
});
