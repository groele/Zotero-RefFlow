import { test } from "node:test";
import assert from "node:assert/strict";
import { formatGraphStatus } from "../src/graph/graphStatus";

test("graph status reports provider provenance and partial origin coverage", () => {
  assert.equal(formatGraphStatus(24, 31, { source: "Connected Papers", partialOrigins: 2 }),
    "24 papers · 31 similarity links · Connected Papers · unresolved origins 2");
});

test("graph status localizes partial coverage and keeps complete results clean", () => {
  assert.equal(formatGraphStatus(3, 2, { language: "zh-CN", source: "Connected Papers", partialOrigins: 1 }),
    "3 篇文献 · 2 条相似关系 · Connected Papers · 未解析起点 1");
  assert.equal(formatGraphStatus(3, 2, { language: "zh-CN", formatTime: () => "16:00", retrievedAt: "fixture" }),
    "3 篇文献 · 2 条相似关系 · Connected Papers · 16:00");
});
