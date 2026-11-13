import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import ReferenceCards from "../src/modules/referenceCards";
import { measureAverageRowHeight, remountVirtualWindow } from "../src/modules/referenceCardsVirtual";

function mockEl(tag: string) {
  const attrs = new Map<string, string>();
  const children: any[] = [];
  const classes = new Set<string>();
  const node: any = {
    tagName: tag.toUpperCase(),
    className: "",
    style: {
      setProperty(k: string, v: string) {
        this[k] = v;
      },
    } as Record<string, any>,
    dataset: {} as Record<string, string>,
    classList: {
      toggle(name: string, force?: boolean) {
        const on = force === undefined ? !classes.has(name) : force;
        if (on) classes.add(name);
        else classes.delete(name);
      },
      contains: (name: string) => classes.has(name),
    },
    hidden: false,
    scrollTop: 0,
    offsetHeight: 0,
    offsetTop: 0,
    ownerDocument: null as any,
    setAttribute(k: string, v: string) {
      attrs.set(k, String(v));
    },
    getAttribute(k: string) {
      return attrs.has(k) ? attrs.get(k)! : null;
    },
    hasAttribute: (k: string) => attrs.has(k),
    removeAttribute(k: string) {
      attrs.delete(k);
    },
    addEventListener() {},
    removeEventListener() {},
    append(...items: any[]) {
      for (const item of items) {
        if (!item) continue;
        if (item.tagName === "#FRAGMENT") children.push(...item._children);
        else children.push(item);
      }
      for (const child of children) child.parentElement = node;
    },
    prepend(...items: any[]) {
      children.unshift(...items.filter(Boolean));
      for (const child of children) child.parentElement = node;
    },
    after() {},
    remove() {},
    replaceChildren(...items: any[]) {
      children.length = 0;
      if (items.length) node.append(...items);
    },
    querySelector(sel: string): any {
      if (sel === "#reference-num") return node._label;
      if (sel.startsWith(".")) {
        const cls = sel.slice(1);
        for (const child of children) {
          if (String(child.className || "").split(/\s+/).includes(cls)) return child;
          const nested = child.querySelector?.(sel);
          if (nested) return nested;
        }
      }
      return null;
    },
    _children: children,
  };
  return node;
}

function mockDoc() {
  const doc: any = {
    activeElement: null,
    defaultView: {
      getComputedStyle: () => ({ fontSize: "13px" }),
      requestAnimationFrame: () => 0,
      cancelAnimationFrame() {},
    },
    createElement(tag: string) {
      const node = mockEl(tag);
      node.ownerDocument = doc;
      return node;
    },
    createElementNS(_ns: string, tag: string) {
      return doc.createElement(tag);
    },
    createDocumentFragment() {
      return mockEl("#FRAGMENT");
    },
  };
  return doc;
}

function withMockGlobals<T>(fn: () => Promise<T>): Promise<T> {
  const prevZotero = (globalThis as any).Zotero;
  const prevToolkit = (globalThis as any).ztoolkit;
  (globalThis as any).Zotero = {
    Prefs: { get: () => "1" },
    Items: { get: () => ({ id: 1, libraryID: 1, deleted: false, isEditable: () => true, getField: () => "" }) },
    Libraries: { get: () => ({ editable: true }) },
    Promise: { delay: () => Promise.resolve() },
  };
  (globalThis as any).ztoolkit = { log() {} };
  return fn().finally(() => {
    (globalThis as any).Zotero = prevZotero;
    (globalThis as any).ztoolkit = prevToolkit;
  });
}

test("virtual mode (>200 refs) keeps natural compact card heights with no fixed 144px blanks", async () => {
  await withMockGlobals(async () => {
    const doc = mockDoc();
    const body = doc.createElement("div");
    body.setAttribute("data-refflow-item-id", "1");
    body.setAttribute("data-refflow-result-source", "PDF");
    body._label = doc.createElement("label");
    const grid = doc.createElement("div");
    const search = doc.createElement("input");
    search.value = "";
    const views: any = { utils: { searchLibraryItem: async () => undefined, API: { retractionChecker: { checkLocal: () => undefined } } } };

    const cards = new ReferenceCards(views, body, grid, search);
    const refs = Array.from({ length: 215 }, (_, i) => ({
      title: `Paper ${i + 1}`,
      text: `Citation ${i + 1}`,
      authors: ["Novoselov, K."],
      year: "2020",
      identifiers: { DOI: `10.1000/${i + 1}` },
    })) as ItemBaseInfo[];

    await cards.render(refs, () => true);

    const mounted = (cards as any).rows as HTMLElement[];
    assert.equal(mounted.length, 60);
    assert.equal((cards as any).virtual, true);
    assert.ok((cards as any).rowHeight >= 84 && (cards as any).rowHeight <= 105);

    for (const row of mounted) {
      assert.equal(row.style.height || "", "", "virtual rows must use natural auto height");
      assert.notEqual(row.style.overflow, "hidden", "virtual rows must not clip overflow at a forced height");
    }

    cards.dispose();
  });
});

test("measureAverageRowHeight computes compact average and remountVirtualWindow preserves anchor scrollTop", async () => {
  await withMockGlobals(async () => {
    const doc = mockDoc();
    const body = doc.createElement("div");
    body.setAttribute("data-refflow-item-id", "1");
    body._label = doc.createElement("label");
    const grid = doc.createElement("div");
    const search = doc.createElement("input");
    search.value = "";
    const views: any = { utils: { searchLibraryItem: async () => undefined, API: { retractionChecker: { checkLocal: () => undefined } } } };

    const cards = new ReferenceCards(views, body, grid, search);
    const refs = Array.from({ length: 220 }, (_, i) => ({
      title: `Ref ${i + 1}`,
      text: `Ref ${i + 1}`,
      authors: [],
      identifiers: {},
    })) as ItemBaseInfo[];
    await cards.render(refs, () => true);

    const host = (cards as any).asVirtualHost();
    const rows = host.rows as any[];
    rows.forEach((row, idx) => {
      row.offsetHeight = idx % 2 === 0 ? 78 : 94;
      row.offsetTop = idx * 86;
    });
    assert.equal(measureAverageRowHeight(rows), 86);

    grid.scrollTop = 1200;
    host.windowStart = 12;
    let remountCount = 0;
    const origReplace = grid.replaceChildren.bind(grid);
    grid.replaceChildren = (...args: any[]) => {
      origReplace(...args);
      remountCount++;
    };
    const origAppend = grid.append.bind(grid);
    grid.append = (...args: any[]) => {
      origAppend(...args);
      const items = grid._children.filter((n: any) => String(n.className || "").includes("reference-item"));
      items.forEach((n: any, idx: number) => {
        n.offsetHeight = idx % 2 === 0 ? 78 : 94;
        n.offsetTop = 1000 + idx * 86;
      });
    };

    await remountVirtualWindow(host, () => true);
    assert.equal(remountCount, 1);
    assert.equal(host.rowHeight, 86);
    assert.equal(host.rowContext().rowHeight, 86);
    assert.ok(grid.scrollTop !== 1200 && grid.scrollTop > 0, "scrollTop adjusted by surviving anchor row offset delta");

    cards.dispose();
  });
});
