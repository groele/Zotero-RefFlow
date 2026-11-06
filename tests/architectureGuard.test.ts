import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const MAX_TARGET_LINE_COUNT = 360;

function findRepoRoot(): string {
  let cur = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(cur, "package.json")) && fs.existsSync(path.join(cur, "src"))) {
      return cur;
    }
    cur = path.dirname(cur);
  }
  return process.cwd();
}

/**
 * List of refactored and modularized source files subject to the strict 360-line guard.
 */
const GUARDED_MODULES = [
  "src/modules/connectedpapers.ts",
  "src/modules/graphStyles.ts",
  "src/modules/graphViewer.ts",
  "src/modules/graphVisualState.ts",
  "src/modules/graphCard.ts",
  "src/modules/graphPanel.ts",
  "src/modules/views.ts",
  "src/modules/referencePaneStyles.ts",
  "src/modules/referenceTip.ts",
  "src/modules/referencePaneDOM.ts",
  "src/modules/referenceAttachment.ts",
  "src/modules/referenceNeighborhood.ts",
  "src/modules/referenceRefreshDispatcher.ts",
  "src/modules/referenceSettingsAction.ts",
  "src/modules/referenceBatchOperations.ts",
  "src/modules/referenceSourceFetchers.ts",
  "src/modules/referencePipeline.ts",
];

test("architecture guard: all source files in src/ respect 360-line ceiling (freeze-and-shrink baseline)", () => {
  const rootDir = findRepoRoot();
  const baselinePath = path.join(rootDir, "scripts/architecture-baseline.json");
  assert.ok(fs.existsSync(baselinePath), "scripts/architecture-baseline.json must exist");
  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  const maxLines = baseline.maxSourceLines || MAX_TARGET_LINE_COUNT;

  function walk(dir: string): string[] {
    const fullDir = path.join(rootDir, dir);
    if (!fs.existsSync(fullDir)) return [];
    return fs.readdirSync(fullDir, { withFileTypes: true }).flatMap((entry) => {
      const rel = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) return walk(rel);
      return entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") ? [rel] : [];
    });
  }

  const allSourceFiles = walk("src");
  assert.ok(allSourceFiles.length >= 60, "Expected at least 60 source files in src/");

  const violations: { file: string; lines: number; maxAllowed: number }[] = [];
  for (const file of allSourceFiles) {
    const fullPath = path.join(rootDir, file);
    const content = fs.readFileSync(fullPath, "utf8");
    const lines = content.trimEnd().split(/\r?\n/).length;
    const frozenCeiling = baseline.oversized[file];

    if (frozenCeiling !== undefined) {
      if (lines > frozenCeiling) {
        violations.push({ file, lines, maxAllowed: frozenCeiling });
      }
    } else if (lines > maxLines) {
      violations.push({ file, lines, maxAllowed: maxLines });
    }
  }

  assert.deepEqual(violations, [], violations.length + " files violated §5.9 360-line baseline");
});

test("architecture guard: baseline contains no stale entries", () => {
  const rootDir = findRepoRoot();
  const baseline = JSON.parse(fs.readFileSync(path.join(rootDir, "scripts/architecture-baseline.json"), "utf8"));
  const maxLines = baseline.maxSourceLines || MAX_TARGET_LINE_COUNT;
  const entries = Object.entries(baseline.oversized as Record<string, number>);

  const problems: string[] = [];
  for (const [file, frozen] of entries) {
    const full = path.join(rootDir, file);
    if (!fs.existsSync(full)) {
      problems.push(file + ": baseline entry points at a non-existent file");
      continue;
    }
    const lines = fs.readFileSync(full, "utf8").trimEnd().split(/\r?\n/).length;
    if (lines <= maxLines) {
      problems.push(file + ": reduced to " + lines + " lines <= " + maxLines + ", remove from baseline");
    }
    if (frozen < lines) {
      problems.push(file + ": frozen ceiling " + frozen + " is lower than current " + lines + " lines");
    }
  }

  assert.deepEqual(problems, [], "Baseline integrity errors: " + problems.join("; "));
});

test("architecture guard: no temporary or version-prefixed identifiers/filenames in source", () => {
  const rootDir = findRepoRoot();
  const scanDirs = ["src/modules", "src/graph", "src/utils"];
  const invalidNamePattern = /^(v\d+[-_]|temp[-_]|test[-_])/i;

  const foundInvalidFiles: string[] = [];

  for (const dir of scanDirs) {
    const fullDir = path.join(rootDir, dir);
    if (!fs.existsSync(fullDir)) continue;
    const entries = fs.readdirSync(fullDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && invalidNamePattern.test(entry.name)) {
        foundInvalidFiles.push(`${dir}/${entry.name}`);
      }
    }
  }

  assert.deepEqual(foundInvalidFiles, [], `Found source files violating naming governance: ${foundInvalidFiles.join(", ")}`);
});

test("architecture guard: views and connectedpapers retain backwards-compatible delegating APIs", async () => {
  const Views = (await import("../src/modules/views")).default;
  const ConnectedPapers = (await import("../src/modules/connectedpapers")).default;

  const viewsProto = Views.prototype;
  assert.equal(typeof viewsProto.refreshReferences, "function");
  assert.equal(typeof viewsProto.smartReferences, "function");
  assert.equal(typeof viewsProto.pdfAttachment, "function");
  assert.equal(typeof viewsProto.pdfCacheSignature, "function");
  assert.equal(typeof viewsProto.sortReferences, "function");
  assert.equal(typeof viewsProto.showTipUI, "function");
  assert.equal(typeof viewsProto.importReferences, "function");
  assert.equal(typeof viewsProto.rollbackReferences, "function");

  const cpProto = ConnectedPapers.prototype;
  assert.equal(typeof cpProto.init, "function");
  assert.equal(typeof cpProto.shutdown, "function");
  assert.equal(typeof cpProto.mountRelatedPane, "function");
  assert.equal(typeof cpProto.unmountRelatedPane, "function");
  assert.equal(typeof cpProto.buildRelatedPanel, "function");
  assert.equal(typeof cpProto.addItem, "function");
});
