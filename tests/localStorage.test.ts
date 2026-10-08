import "./setup";
import { test, describe } from "node:test";
import assert from "node:assert";
import LocalStorage from "../src/modules/localStorage";

describe("LocalStorage Suite", () => {
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
