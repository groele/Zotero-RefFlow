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

test("architecture guard: refactored graph and views modules must stay within 360 lines", () => {
  const rootDir = findRepoRoot();
  const violations: { file: string; lines: number }[] = [];

  for (const relativePath of GUARDED_MODULES) {
    const fullPath = path.join(rootDir, relativePath);
    assert.ok(fs.existsSync(fullPath), `Guarded module file does not exist: ${relativePath}`);
    const content = fs.readFileSync(fullPath, "utf8");
    const lines = content.split("\n").length;
    if (lines > MAX_TARGET_LINE_COUNT) {
      violations.push({ file: relativePath, lines });
    }
  }

  assert.deepEqual(violations, [], `The following modules exceed the ${MAX_TARGET_LINE_COUNT}-line limit: ${JSON.stringify(violations)}`);
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
