import { test } from "node:test";
import assert from "node:assert/strict";
import { migrateRefNexusPreferences } from "../src/utils/identityMigration";

function harness() {
  const old = new Map<string, unknown>([["autoRefresh", true], ["showTipAfterMillisecond", 345],
    ["openAlexKey", "private-fixture-key"], ["sortBy", "Title"], ["validationRestartVersion", "11.0.3"]]);
  const current = new Map<string, unknown>([["sortBy", "Original"]]);
  const branch = (values: Map<string, unknown>) => ({
    prefHasUserValue: (key: string) => values.has(key),
    getPrefType: (key: string) => typeof values.get(key) === "boolean" ? 128 : typeof values.get(key) === "number" ? 64 : 32,
    getBoolPref: (key: string, fallback?: boolean) => values.get(key) ?? fallback,
    getIntPref: (key: string) => values.get(key), getStringPref: (key: string) => values.get(key),
    setBoolPref: (key: string, value: unknown) => values.set(key, value),
    setIntPref: (key: string, value: unknown) => values.set(key, value),
    setStringPref: (key: string, value: unknown) => values.set(key, value),
  });
  return { old, current, service: { getBranch: (name: string) => branch(name.includes("refnexus") ? old : current) } };
}
test("identity migration retains typed user settings and keys without altering the old branch", () => {
  const h = harness(), before = [...h.old];migrateRefNexusPreferences(h.service);
  assert.equal(h.current.get("autoRefresh"), true);assert.equal(h.current.get("showTipAfterMillisecond"), 345);
  assert.equal(h.current.get("openAlexKey"), "private-fixture-key");assert.deepEqual([...h.old], before);
  assert.equal(h.current.has("validationRestartVersion"), false);
});
test("identity migration preserves new settings and runs only once", () => {
  const h = harness();migrateRefNexusPreferences(h.service);
  assert.equal(h.current.get("sortBy"), "Original");h.old.set("showTipAfterMillisecond", 999);
  migrateRefNexusPreferences(h.service);assert.equal(h.current.get("showTipAfterMillisecond"), 345);
});
test("a failed copy can retry without overwriting an already copied value", () => {
  const h = harness();const getBranch = h.service.getBranch;
  h.service.getBranch = (name: string) => {
    const branch = getBranch(name);
    if (name.includes("refflow")) branch.setIntPref = () => { throw new Error("write failed"); };
    return branch;
  };
  assert.throws(() => migrateRefNexusPreferences(h.service), /write failed/);
  assert.equal(h.current.has("migratedRefNexus"), false);h.service.getBranch = getBranch;
  migrateRefNexusPreferences(h.service);assert.equal(h.current.get("migratedRefNexus"), true);
});
