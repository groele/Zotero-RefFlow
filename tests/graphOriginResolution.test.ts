import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveGraphOrigins } from "../src/modules/graphOriginResolution";

const item = (id: number) => ({ id });

test("graph origins omit failed resolutions and report partial coverage", async () => {
  const result = await resolveGraphOrigins([item(1), item(2), item(3)], async row => {
    if (row.id === 2) throw new Error("Semantic Scholar unavailable");
    return row.id === 1 ? "paper-a" : "paper-c";
  });
  assert.deepEqual(result.ids, ["paper-a", "paper-c"]);
  assert.deepEqual(result.resolvedItemIDs, [1, 3]);
  assert.deepEqual(result.unresolvedItemIDs, [2]);
  assert.equal(result.cancelled, false);
});

test("graph origins deduplicate provider identities without losing Zotero origin coverage", async () => {
  const result = await resolveGraphOrigins([item(1), item(2)], async () => "same-paper");
  assert.deepEqual(result.ids, ["same-paper"]);
  assert.deepEqual(result.resolvedItemIDs, [1, 2]);
  assert.deepEqual(result.unresolvedItemIDs, []);
});

test("graph origins reject empty and delimiter-bearing provider IDs", async () => {
  const values = ["", "  ", "paper-a+paper-b", "https://example.org/paper"];
  const result = await resolveGraphOrigins(values.map((_, index) => item(index + 1)), async row => values[row.id - 1]);
  assert.deepEqual(result.ids, []);
  assert.deepEqual(result.unresolvedItemIDs, [1, 2, 3, 4]);
});

test("cancelled graph-origin resolution does not call the provider", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const result = await resolveGraphOrigins([item(1)], async () => { calls++; return "paper-a"; }, controller.signal);
  assert.equal(calls, 0);
  assert.equal(result.cancelled, true);
  assert.deepEqual(result.ids, []);
});
