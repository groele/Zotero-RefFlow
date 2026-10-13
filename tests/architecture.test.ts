import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { pollGraph } from "../src/modules/graphTransport";
import PublisherReferences from "../src/modules/publisherReferences";
import ReferenceTasks from "../src/modules/referenceTasks";
import Utils from "../src/modules/utils";
import BatchImporter from "../src/modules/batchImporter";

test("CNKI search encodes Chinese titles and form delimiters without JSON corruption", async () => {
  const original = Zotero.HTTP.request, utils = new Utils();
  const title='中文 "标题" & 查询=完整';let sent = false;
  Zotero.HTTP.request = async (method:string,_url:string,options:any) => {
    sent = true;assert.equal(method,"POST");
    const form=new URLSearchParams(options.body), query=JSON.parse(form.get("QueryJson")!);
    assert.equal(query.QNode.QGroup[0].Items[0].Value,title);
    assert.equal(form.get("CurPage"),"1");assert.equal(form.size,12);
    assert.equal(options.headers["Content-Length"],undefined);assert.equal(options.errorDelayMax,0);
    return {status:200,response:"<html></html>"};
  };
  try {await utils.API.getCNKIURL(title,true);assert.equal(sent,true);}
  finally {utils.API.requests.dispose();Zotero.HTTP.request=original;}
});

test("disposed pane tasks cannot restart or invoke already-cancelled work", async () => {
  const tasks = new ReferenceTasks();let calls = 0;
  const pending = tasks.run({}, "pending", async () => { calls++; });
  tasks.dispose();await pending;await tasks.run({}, "late", async () => { calls++; });
  assert.equal(calls, 0);assert.equal(tasks.size, 0);
});

test("publisher cancellation reaches active HTTP and releases the scheduler", async () => {
  const original = Zotero.HTTP.request;let stopped = 0;
  Zotero.HTTP.request = async (_method: string, _url: string, options: any) => {
    options.cancellerReceiver(() => stopped++);return new Promise(() => {});
  };
  const provider = new PublisherReferences(), controller = new AbortController();
  try {
    const pending = provider.getReferences("10.1234/publisher", "https://www.nature.com/articles/fixture", "Fixture", controller.signal);
    await Promise.resolve();controller.abort();
    assert.deepEqual(await pending, []);assert.equal(stopped, 1);
    assert.equal((provider as any).requests.active, 0);
  } finally { provider.dispose();Zotero.HTTP.request = original; }
});

test("notification during library lookup cannot restore a stale cached miss", async () => {
  const utils = new Utils();let release!: (value: any) => void;
  (utils as any).searchItem = () => new Promise(resolve => { release = resolve; });
  const ref: any = { title: "Cache race fixture", identifiers: {} };
  const pending = utils.searchLibraryItem(ref, 1);
  while (!release) await new Promise(resolve => setTimeout(resolve, 0));
  utils.clearLibraryItemCache();release(undefined);await pending;
  assert.equal((utils as any).itemCache.size, 0);
});

test("simultaneous library lookups share one native search", async () => {
  const utils = new Utils();let calls = 0;let release!: (value: any) => void;
  (utils as any).searchItem = () => { calls++;return new Promise(resolve => { release = resolve; }); };
  const ref: any = { title: "Shared search fixture", identifiers: {} };
  const a = utils.searchLibraryItem({ ...ref }, 1), b = utils.searchLibraryItem({ ...ref }, 1);
  await new Promise(resolve => setTimeout(resolve, 5));release(undefined);await Promise.all([a,b]);
  assert.equal(calls, 1);
});

test("mixed-library graph imports reject before any database mutation", async () => {
  const z: any = Zotero, original = z.Libraries;z.Libraries = { get: () => ({ editable: true }) };
  const parent: any = { id: 1, libraryID: 1, isRegularItem: () => true };
  try {
    await assert.rejects(BatchImporter.importAll(parent, [{ title: "Fixture", identifiers: {} } as any],
      { relatedParents: [{ ...parent, id: 2, libraryID: 42 }] }), /one editable library/);
  } finally { z.Libraries = original; }
});

test("native graph polling re-fetches pending statuses and sends the official key header", async () => {
  const original = Zotero.HTTP.request;let calls = 0;const progress: string[] = [];
  Zotero.HTTP.request = async (_method: string, url: string, options: any) => {
    assert.ok(url.includes("/papers-api/graph/1/abc"));assert.equal(options.headers["X-Api-Key"], "fixture-key");
    return { status: 200, response: ++calls < 3 ? { status: "IN_PROGRESS" } : { status: "FRESH_GRAPH", graph_json: { nodes: {} } } };
  };
  try {
    const result = await pollGraph("abc", "fixture-key", response => progress.push(response.status), undefined, 500, 1);
    assert.equal(result.status, "FRESH_GRAPH");assert.equal(calls, 3);assert.equal(progress.length, 3);
  } finally { Zotero.HTTP.request = original; }
});

test("graph cancellation aborts an HTTP transport that never resolves", async () => {
  const original = Zotero.HTTP.request;let stopped = 0;
  Zotero.HTTP.request = async (_method: string, _url: string, options: any) => {
    options.cancellerReceiver(() => stopped++);return new Promise(() => {});
  };
  try {
    const controller = new AbortController();const pending = pollGraph("abc", "key", () => {}, controller.signal);
    controller.abort();await assert.rejects(pending, { name: "AbortError" });assert.equal(stopped, 1);
  } finally { Zotero.HTTP.request = original; }
});

test("graph deadline stops both transport and background polling", async () => {
  const original = Zotero.HTTP.request;let stopped = 0;
  Zotero.HTTP.request = async (_method: string, _url: string, options: any) => {
    options.cancellerReceiver(() => stopped++);return new Promise(() => {});
  };
  try { await assert.rejects(pollGraph("abc", "key", () => {}, undefined, 15), { name: "TimeoutError" });assert.equal(stopped,1); }
  finally { Zotero.HTTP.request = original; }
});
