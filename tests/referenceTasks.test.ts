import { test } from "node:test";
import assert from "node:assert/strict";
import ReferenceTasks from "../src/modules/referenceTasks";

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
