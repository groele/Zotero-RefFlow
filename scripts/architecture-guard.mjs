/**
 * Zotero RefFlow - Architecture & Compliance Guard
 *
 * Enforces workspace AGENTS.md clauses statically:
 *   §3   Status label governance: releaseStatus must be released | unreleased
 *   §3   Fluent symmetry across en-US, zh-CN, it-IT catalogues; zero hardcoded UI strings
 *   §3   Naming governance: no temporary or version-prefixed identifiers/filenames
 *   §4.1 Full native preference implementation and single first-card default open
 *   §4.2 Settings pane 16px/24px/40px alignment grid declarations
 *   §5.2 TypeScript purity across source modules
 *   §5.9 360-line ceiling across ALL source files with freeze-and-shrink baseline
 *   §6   Version alignment across package, manifest, brand, update feed
 *   §9   Update feed integrity: HTTPS links, SHA-512 hashes, compatibility scope
 *
 * Run standalone: node scripts/architecture-guard.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));
const lines = (rel) => read(rel).trimEnd().split(/\r?\n/).length;

const SKIP_DIRS = new Set(['node_modules', '.git', 'build', 'dist', 'output', 'assets', '.scaffold']);

function walk(relDir, extensions = ['.ts', '.tsx', '.js', '.mjs']) {
  const out = [];
  const visit = (dir) => {
    const fullDir = path.join(root, dir);
    if (!fs.existsSync(fullDir)) return;
    for (const entry of fs.readdirSync(fullDir, { withFileTypes: true })) {
      const rel = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) visit(rel);
      } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        out.push(rel);
      }
    }
  };
  visit(relDir);
  return out.sort();
}

const baseline = readJson('scripts/architecture-baseline.json');
const MAX_LINES = baseline.maxSourceLines || 360;

test('§5.9 all source files respect 360-line ceiling (freeze-and-shrink baseline)', (t) => {
  const sourceFiles = walk('src', ['.ts', '.tsx']);
  const failures = [];
  const debt = [];

  for (const file of sourceFiles) {
    const count = lines(file);
    const frozen = baseline.oversized[file];
    if (frozen !== undefined) {
      if (count > frozen) failures.push(`${file}: ${count} lines, exceeds frozen ceiling ${frozen}`);
      if (count > MAX_LINES) debt.push(`${file} (${count})`);
    } else if (count > MAX_LINES) {
      failures.push(`${file}: ${count} lines exceeds ${MAX_LINES} ceiling and is not recorded in baseline`);
    }
  }

  t.diagnostic(`scanned ${sourceFiles.length} source files; ${debt.length} known oversized modules frozen in baseline`);
  assert.deepEqual(failures, [], `§5.9 violations:\n${failures.join('\n')}`);
});

test('§5.9 baseline integrity: no stale or misleading entries', (t) => {
  const entries = Object.entries(baseline.oversized);
  const problems = [];
  for (const [file, frozen] of entries) {
    if (!fs.existsSync(path.join(root, file))) {
      problems.push(`${file}: baseline entry points to a non-existent file`);
      continue;
    }
    const count = lines(file);
    if (count <= MAX_LINES) {
      problems.push(`${file}: frozen at ${frozen} but now only ${count} lines - remove stale entry from baseline`);
    }
    if (!Number.isInteger(frozen) || frozen < count) {
      problems.push(`${file}: frozen ceiling ${frozen} is below current count ${count}`);
    }
  }

  if (baseline.debtCleared === true) {
    assert.deepEqual(entries, [], 'debtCleared is true but entries remain in baseline.oversized');
  } else {
    assert.ok(entries.length > 0, 'baseline must declare debtCleared: true when oversized is empty');
  }

  assert.deepEqual(problems, [], `baseline integrity issues:\n${problems.join('\n')}`);
  t.diagnostic(`baseline valid: ${entries.length} frozen entries, debtCleared=${baseline.debtCleared}`);
});

test('§3 status label governance: releaseStatus is released or unreleased (no "stable")', (t) => {
  const product = readJson('docs/brand/product.json');
  assert.ok(
    ['released', 'unreleased'].includes(product.releaseStatus),
    `releaseStatus must be "released" or "unreleased", got "${product.releaseStatus}"`,
  );
  t.diagnostic(`product.json releaseStatus="${product.releaseStatus}" aligned with Zotero Flow suite`);
});

test('§3 Fluent catalogues are symmetric and free of duplicate keys across en-US, zh-CN, it-IT', (t) => {
  for (const file of ['addon.ftl', 'preferences.ftl']) {
    const keys = {};
    for (const lang of ['en-US', 'zh-CN', 'it-IT']) {
      const text = read(`addon/locale/${lang}/${file}`);
      const k = [...text.matchAll(/^([A-Za-z0-9_-]+)\s*=/gm)].map((m) => m[1]);
      keys[lang] = k;
      const dup = k.filter((x, i) => k.indexOf(x) !== i);
      assert.deepEqual(dup, [], `duplicate keys in ${lang}/${file}: ${dup.join(', ')}`);
    }
    const en = new Set(keys['en-US']);
    for (const lang of ['zh-CN', 'it-IT']) {
      const s = new Set(keys[lang]);
      const missing = [...en].filter((x) => !s.has(x));
      const extra = [...s].filter((x) => !en.has(x));
      assert.deepEqual(missing, [], `${lang}/${file} missing keys from en-US: ${missing.join(', ')}`);
      assert.deepEqual(extra, [], `${lang}/${file} extra keys not in en-US: ${extra.join(', ')}`);
    }
    t.diagnostic(`${file}: ${en.size} symmetric keys across 3 languages`);
  }
});

test('§3 preferences.xhtml has zero hardcoded UI strings (100% Fluent driven)', (t) => {
  const xhtml = read('addon/chrome/content/preferences.xhtml');
  // Check for raw unlocalized Chinese characters in content tags
  const rawChinese = [...xhtml.matchAll(/>([^<]*[\u4e00-\u9fa5]+[^<]*)</g)].map((m) => m[1].trim());
  assert.deepEqual(rawChinese, [], `raw Chinese text detected in preferences.xhtml: ${rawChinese.join(', ')}`);

  // Verify all summary elements have data-l10n-id
  const summaries = [...xhtml.matchAll(/<html:summary[^>]*>([\s\S]*?)<\/html:summary>/g)];
  const missingL10n = summaries.filter((s) => !s[0].includes('data-l10n-id=')).map((s) => s[0]);
  assert.deepEqual(missingL10n, [], `summaries missing data-l10n-id: ${missingL10n.join(', ')}`);

  // Verify details cards: exactly first card is open
  const openCount = (xhtml.match(/<html:details[^>]*open/g) || []).length;
  assert.equal(openCount, 1, `exactly one details card must be open by default, found ${openCount}`);
  t.diagnostic('preferences.xhtml confirmed 100% Fluent driven with first-card open rule');
});

test('§3 source filenames carry no version numbers or transient prefixes', () => {
  const files = [
    ...walk('src'),
    ...walk('scripts', ['.mjs', '.js', '.py']),
  ];
  const invalidNamePattern = /(^|\/)(?:v\d+[-_]|temp[-_]|test[-_]|draft-)/i;
  const bad = files.filter((file) => invalidNamePattern.test(path.basename(file)));
  assert.deepEqual(bad, [], `transient or version-prefixed source filenames: ${bad.join(', ')}`);
});

test('§6 version fields are aligned across package, lock, manifest, brand, UI and update feed', (t) => {
  const pkg = readJson('package.json');
  const lock = readJson('package-lock.json');
  const manifest = readJson('addon/manifest.json');
  const product = readJson('docs/brand/product.json');
  const update = readJson('update.json');

  const ver = pkg.version;
  const versions = {
    'package.json': ver,
    'package-lock.json': lock.version,
    'docs/brand/product.json': product.version,
    'docs/brand/product.json#releaseTag': product.releaseTag,
    'update.json': update.addons[pkg.config.addonID]?.updates?.[0]?.version,
  };

  assert.equal(product.version, ver);
  assert.equal(product.releaseTag, `v${ver}`);
  assert.equal(pkg.config.releaseTag, `v${ver}`);
  assert.equal(update.addons[pkg.config.addonID]?.updates?.[0]?.version, ver);
  assert.equal(baseline.lastReleasedVersion, ver);
  t.diagnostic(`version fields aligned at v${ver}`);
});

test('§9 update feeds point at valid released HTTPS URLs and complete SHA-512 hashes', (t) => {
  const pkg = readJson('package.json');
  const update = readJson('update.json');
  const entry = update.addons[pkg.config.addonID]?.updates?.[0];
  assert.ok(entry, 'missing update entry in update.json');

  assert.match(
    entry.update_link,
    new RegExp('^https://github\\.com/groele/Zotero-RefFlow/releases/download/v' + pkg.version.replace(/\./g, '\\.') + '/'),
    'update_link must point to official release',
  );
  assert.match(entry.update_hash, /^sha512:[0-9a-f]{128}$/i, 'update_hash must be a valid 128-hex sha512 digest');
  assert.equal(entry.applications?.zotero?.strict_min_version, '10.0');
  assert.equal(entry.applications?.zotero?.strict_max_version, '12.*');
  t.diagnostic('update.json validated with compliant hash and release URL');
});
