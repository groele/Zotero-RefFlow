import { test } from "node:test";
import assert from "node:assert/strict";
import { cacheReferences, readCachedReferences } from "../src/modules/referenceCache";

test("reference caches reject changed PDFs, stale metadata, and malformed rows", () => {
  const record = cacheReferences([{title:"Paper",identifiers:{DOI:"10.1234/a"}}],"pdf:size:mtime",1000);
  assert.equal(readCachedReferences(record,"pdf:changed",500,1100),undefined);
  assert.equal(readCachedReferences(record,"pdf:size:mtime",500,1600),undefined);
  assert.equal(readCachedReferences({...record,references:[null]},"pdf:size:mtime",500,1100),undefined);
  assert.equal(readCachedReferences([{title:"Legacy"}],"pdf:size:mtime",500,1100),undefined);
  assert.equal(readCachedReferences(record,"pdf:size:mtime",500,1100)?.length,1);
});

test("cached reference metadata drops live Zotero objects and returns fresh identity objects", () => {
  const live: any = {id:123};live.self=live;
  const record=cacheReferences([{title:"Paper",identifiers:{DOI:"10.1234/a"},_item:live}],"sig");
  assert.doesNotThrow(()=>JSON.stringify(record));
  const first=readCachedReferences(record,"sig",1000)!;
  first[0].identifiers.DOI="changed";
  assert.equal(readCachedReferences(record,"sig",1000)?.[0].identifiers.DOI,"10.1234/a");
  assert.equal(first[0]._item,undefined);
});
