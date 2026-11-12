import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ListIndices } from "../src/modules/listIndices";

function refs(n: number): ItemBaseInfo[] {
  return Array.from({ length: n }, (_, index) => ({
    title: `Paper ${index}`,
    text: `Paper ${index}`,
    authors: [],
    identifiers: {},
    number: index + 1,
    _item: index % 3 === 0 ? ({ id: index } as any) : undefined,
    isOA: index % 5 === 0,
  }));
}

test("ListIndices always applies matches so empty search still honors filter modes", () => {
  const list = new ListIndices();
  const items = refs(12);
  const unimported = (ref: ItemBaseInfo) => !ref._item;
  const first = list.forList(items, items, "", unimported, "unimported");
  assert.deepEqual(first.indices, [1, 2, 4, 5, 7, 8, 10, 11]);
  const again = list.forList(items, items, "", unimported, "unimported");
  assert.equal(again.indices, first.indices);
  const imported = list.forList(items, items, "", (ref) => Boolean(ref._item), "imported");
  assert.deepEqual(imported.indices, [0, 3, 6, 9]);
});

test("ListIndices rebuilds when only the filter key changes", () => {
  const list = new ListIndices();
  const items = refs(6);
  const all = list.forList(items, items, "", () => true, "all");
  assert.equal(all.indices.length, 6);
  const oa = list.forList(items, items, "", (ref) => Boolean(ref.isOA), "oa");
  assert.deepEqual(oa.indices, [0, 5]);
});

test("ListIndices keeps numbering width from the source list across scrolls", () => {
  const list = new ListIndices();
  const items = refs(250);
  const first = list.forList(items, items, "", () => true, "all");
  assert.equal(first.width >= 3, true);
  const second = list.forList(items, items, "", () => true, "all");
  assert.equal(second.numbers, first.numbers);
  assert.equal(second.width, first.width);
});
