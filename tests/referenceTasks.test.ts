import { test } from "node:test";
import assert from "node:assert/strict";
import ReferenceTasks from "../src/modules/referenceTasks";

for (const reject of [false, true]) {
  test(`settled ${reject ? "failed" : "successful"} pane work revokes its cancellation signal`, async () => {
    const tasks = new ReferenceTasks(), pane = {};
    let signal!: AbortSignal;
    let active = 0;
    const pending = tasks.run(pane, "finished", async ctx => {
      signal = ctx.signal;
      active++;
      signal.addEventListener("abort", () => active--, { once: true });
      if (reject) throw new Error("provider failed");
    });
    if (reject) await assert.rejects(pending, /provider failed/);
    else await pending;
    assert.equal(signal.aborted, true);
    assert.equal(active, 0);
    assert.equal(tasks.size, 0);
    tasks.dispose();
  });
}

test("completion cleanup cannot delete a replacement launched by an abort listener", async () => {
  const tasks = new ReferenceTasks(), pane = {};
  let next: Promise<void> | undefined, release!: () => void;
  const gate = new Promise<void>(resolve => release = resolve);
  await tasks.run(pane, "first", async ctx => {
    ctx.signal.addEventListener("abort", () => {
      next = tasks.run(pane, "second", async () => gate);
    }, { once: true });
  });
  assert.ok(next);
  assert.equal(tasks.size, 1);
  release(); await next;
  assert.equal(tasks.size, 0);
  tasks.dispose();
});

test("a superseded pane request cannot commit after the new request", async () => {
  const tasks = new ReferenceTasks(), pane = {}, committed: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => release = resolve);
  const old = tasks.run(pane, "item-A|PDF", async ctx => { await gate; if (ctx.isCurrent()) committed.push("A"); });
  await Promise.resolve();
  await tasks.run(pane, "item-B|API", async ctx => { if (ctx.isCurrent()) committed.push("B"); });
  release(); await old;
  assert.deepEqual(committed, ["B"]);
  assert.equal(tasks.size, 0);
});

test("identical repeated pane requests share one operation", async () => {
  const tasks = new ReferenceTasks(), pane = {}; let calls = 0;
  const job = async () => { calls++; await Promise.resolve(); };
  await Promise.all([tasks.run(pane,"same",job),tasks.run(pane,"same",job)]);
  assert.equal(calls,1);
});

test("invalidate and dispose abort active jobs and release pane references", async () => {
  const tasks = new ReferenceTasks(), pane = {}; let signal!: AbortSignal;
  const job = tasks.run(pane,"same",async ctx => { signal=ctx.signal; await Promise.resolve(); });
  await Promise.resolve(); tasks.invalidate(pane); assert.equal(signal.aborted,true); await job;
  const next=tasks.run({},"other",async ctx => {signal=ctx.signal;await Promise.resolve();});
  await Promise.resolve();tasks.dispose();assert.equal(signal.aborted,true);await next;assert.equal(tasks.size,0);
});
