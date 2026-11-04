import { test } from "node:test";
import assert from "node:assert/strict";
import { buildConnectedPapersPipeline } from "../src/modules/connectedPapersPipeline";

const item = (id: number, libraryID = 1) => ({ id, libraryID }) as Zotero.Item;
const graph = () => ({ nodes: { a: { paperId: "a" }, b: { paperId: "b" } } }) as unknown as Graph;

test("Connected Papers keeps a useful graph and marks unresolved origins as partial", async () => {
  const requested: string[] = [];
  const result = await buildConnectedPapersPipeline([item(1), item(2)], {
    resolvePaperID: async origin => origin.id === 1 ? "s2-a" : undefined,
    fetchGraph: async key => { requested.push(key); return graph(); },
    findLocalItem: async () => undefined,
  });
  assert.deepEqual(requested, ["s2-a"]);
  assert.equal(result.status, "partial");
  assert.deepEqual(result.origins.unresolvedItemIDs, [2]);
  assert.equal(result.source, "Connected Papers");
  assert.equal(Object.keys(result.graph!.nodes).length, 2);
});

test("Connected Papers does not query with undefined when every origin fails", async () => {
  let requests = 0;
  const result = await buildConnectedPapersPipeline([item(1), item(2)], {
    resolvePaperID: async () => undefined,
    fetchGraph: async () => { requests++; return graph(); },
    findLocalItem: async () => undefined,
  });
  assert.equal(requests, 0);
  assert.equal(result.status, "origins-unavailable");
  assert.deepEqual(result.origins.unresolvedItemIDs, [1, 2]);
});

test("Connected Papers local matching checks each owning library and records only Zotero identity", async () => {
  const requests: Array<[string, number]> = [];
  const fixture = graph();
  const result = await buildConnectedPapersPipeline([item(1, 1), item(2, 42)], {
    resolvePaperID: async origin => `s2-${origin.id}`,
    fetchGraph: async () => fixture,
    findLocalItem: async (paper, libraryID) => {
      requests.push([paper.paperId, libraryID]);
      return paper.paperId === "a" && libraryID === 42 ? ({ id: 777 } as Zotero.Item) : undefined;
    },
  });
  assert.deepEqual(requests, [["a", 1], ["a", 42], ["b", 1], ["b", 42]]);
  assert.equal((fixture.nodes.a as any)._itemID, 777);
  assert.equal((fixture.nodes.b as any)._itemID, undefined);
  assert.equal(result.status, "success");
  assert.equal(result.source, "Connected Papers");
});

test("Connected Papers cancellation during indexing prevents later library reads and graph commit", async () => {
  const controller = new AbortController();
  let lookups = 0;
  const result = await buildConnectedPapersPipeline([item(1)], {
    resolvePaperID: async () => "s2-a",
    fetchGraph: async () => graph(),
    findLocalItem: async () => { lookups++; controller.abort(); return undefined; },
  }, controller.signal);
  assert.equal(lookups, 1);
  assert.equal(result.status, "cancelled");
  assert.equal(result.graph, undefined);
});
