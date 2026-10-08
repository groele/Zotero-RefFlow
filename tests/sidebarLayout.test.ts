import { test } from "node:test";
import assert from "node:assert/strict";
import { restoreLegacySidebarLayout } from "../src/modules/sidebarLayout";

function fixture(orient: string | null = "vertical", extra = false) {
  const host: any = { localName: "item-pane", children: [], getAttribute: () => orient, removeAttribute: () => { orient = null; } };
  const content: any = { parentElement: host };
  const rail: any = { parentElement: host };
  host.children = [content, rail];
  if (extra) host.children.push({});
  const nodes: any = { "zotero-item-pane": host, "zotero-item-pane-content": content, "zotero-view-item-sidenav": rail };
  const doc: any = { getElementById: (id: string) => nodes[id] };
  return { doc, host, content, rail, nodes, orient: () => orient };
}

test("hot upgrade repairs the legacy vertical host mutation and is idempotent", () => {
  const f = fixture();
  assert.equal(restoreLegacySidebarLayout(f.doc), true);
  assert.equal(f.orient(), null);
  assert.equal(restoreLegacySidebarLayout(f.doc), false);
});

test("normal Zotero host layout stays untouched", () => {
  for (const orient of [null, "horizontal"]) {
    const f = fixture(orient);
    assert.equal(restoreLegacySidebarLayout(f.doc), false);
    assert.equal(f.orient(), orient);
  }
});

test("unknown custom host children and reparented rails are left alone", () => {
  const extra = fixture("vertical", true);
  assert.equal(restoreLegacySidebarLayout(extra.doc), false);
  assert.equal(extra.orient(), "vertical");
  const moved = fixture();
  moved.rail.parentElement = {};
  assert.equal(restoreLegacySidebarLayout(moved.doc), false);
  assert.equal(moved.orient(), "vertical");
});

test("legacy related panel is removed only when it is a direct host child", () => {
  const f = fixture();
  let removed = false;
  const legacy: any = { parentElement: f.host, remove: () => { removed = true; } };
  f.nodes["connected-papers-relatedsplit-after"] = legacy;
  f.host.children.push(legacy);
  assert.equal(restoreLegacySidebarLayout(f.doc), true);
  assert.equal(removed, true);
});
