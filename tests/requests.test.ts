import "./setup";
import { test, describe } from "node:test";
import assert from "node:assert";
import Requests from "../src/modules/requests";

describe("Requests Suite", () => {
  test("should promote cache hits before evicting the least recently used entry", () => {
    const requests = new Requests();
    // Fill cache with MAX_CACHE_ENTRIES
    for (let i = 0; i < 500; i++) {
      requests.setCache(`key_${i}`, `val_${i}`);
    }
    assert.strictEqual(requests.getCache("key_0"), "val_0");
    assert.strictEqual(requests.getCache("key_499"), "val_499");

    // Add 501st entry - key_0 was accessed, but key_1 is now oldest
    requests.setCache("key_500", "val_500");
    // Size should still be 500
    assert.strictEqual((requests as any).cache.size, 500);
    assert.strictEqual(requests.getCache("key_500"), "val_500");
    assert.strictEqual(requests.getCache("key_0"), "val_0");
    assert.strictEqual(requests.getCache("key_1"), undefined);
  });

  test("should properly format DOI path for content negotiation", () => {
    const requests = new Requests();
    const formatted = (requests as any).formatDOIPath("10.1038/s41586-020-2649-2");
    assert.strictEqual(formatted, "10.1038/s41586-020-2649-2");

    const formattedWithPrefix = (requests as any).formatDOIPath("https://doi.org/10.1038/s41586-020-2649-2");
    assert.strictEqual(formattedWithPrefix, "10.1038/s41586-020-2649-2");
  });

  test("should retrieve cached value without re-querying", async () => {
    const requests = new Requests();
    const cacheKey = (requests as any).getCacheKey("GET", "https://api.test/cached", { responseType: "json", headers: {} });
    requests.setCache(cacheKey, { cached: true });

    const result = await requests.get("https://api.test/cached");
    assert.deepStrictEqual(result, { cached: true });
  });

  test("should deduplicate concurrent identical GET requests", async () => {
    const requests = new Requests();
    const originalRequest = Zotero.HTTP.request;
    let calls = 0;
    Zotero.HTTP.request = async () => {
      calls++;
      await new Promise(resolve => setTimeout(resolve, 10));
      return { status: 200, response: { shared: true } };
    };

    try {
      const [first, second] = await Promise.all([
        requests.get("https://api.test/shared"),
        requests.get("https://api.test/shared")
      ]);
      assert.deepStrictEqual(first, { shared: true });
      assert.deepStrictEqual(second, { shared: true });
      assert.strictEqual(calls, 1);
    } finally {
      Zotero.HTTP.request = originalRequest;
    }
  });

  test("should keep POST response types and headers isolated in the cache", async () => {
    const requests = new Requests();
    const originalRequest = Zotero.HTTP.request;
    const responseTypes: string[] = [];
    Zotero.HTTP.request = async (_method: string, _url: string, options: any) => {
      responseTypes.push(options.responseType);
      return { status: 200, response: options.responseType };
    };

    try {
      assert.strictEqual(await requests.post("https://api.test/post", { q: 1 }, "json"), "json");
      assert.strictEqual(await requests.post("https://api.test/post", { q: 1 }, "text"), "text");
      assert.deepStrictEqual(responseTypes, ["json", "text"]);
    } finally {
      Zotero.HTTP.request = originalRequest;
    }
  });
});
