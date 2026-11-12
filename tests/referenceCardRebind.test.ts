import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { rebindReferenceCardRow } from "../src/modules/referenceCardRebind";

function el(tag: string, className?: string) {
  const attrs = new Map<string, string>();
  const children: any[] = [];
  const node: any = {
    tagName: tag.toUpperCase(),
    className: className || "",
    style: {},
    classList: {
      values: new Set<string>(),
      toggle(name: string, force?: boolean) {
        const on = force === undefined ? !this.values.has(name) : force;
        if (on) this.values.add(name);
        else this.values.delete(name);
      },
      contains(name: string) {
        return this.values.has(name);
      },
    },
    textContent: "",
    title: "",
    disabled: false,
    dataset: {} as Record<string, string>,
    ownerDocument: {
      createElement: (name: string) => el(name),
      createElementNS: (_ns: string, name: string) => el(name),
    },
    setAttribute(name: string, value: string) {
      attrs.set(name, String(value));
    },
    getAttribute(name: string) {
      return attrs.has(name) ? attrs.get(name)! : null;
    },
    hasAttribute(name: string) {
      return attrs.has(name);
    },
    removeAttribute(name: string) {
      attrs.delete(name);
    },
    append(...nodes: any[]) {
      children.push(...nodes);
      for (const child of nodes) child.parentElement = node;
    },
    prepend(...nodes: any[]) {
      children.unshift(...nodes);
      for (const child of nodes) child.parentElement = node;
    },
    remove() {
      node._removed = true;
    },
    querySelector(selector: string) {
      const match = (candidate: any): any => {
        if (selector.startsWith(".") && candidate.className === selector.slice(1)) return candidate;
        for (const child of candidate._children || []) {
          const found = match(child);
          if (found) return found;
        }
        return null;
      };
      return match(node);
    },
    replaceChildren(...nodes: any[]) {
      children.length = 0;
      children.push(...nodes);
    },
    _children: children,
  };
  Object.defineProperty(node, "children", { get: () => children });
  return node;
}

function card(ref: ItemBaseInfo) {
  const row = el("div", "reference-item");
  (row as any).reference = ref;
  const citation = el("div", "reference-citation");
  const marker = el("div", "reference-marker");
  const number = el("span", "reference-number");
  const text = el("span", "reference-text");
  const description = el("div", "reference-description");
  const heading = el("div", "reference-heading");
  const state = el("span", "reference-state");
  const title = el("strong", "reference-title");
  const action = el("button", "reference-action");
  const metadata = el("div", "reference-metadata");
  const about = el("span", "reference-about");
  marker.append(number);
  citation.append(marker, text);
  heading.append(state, title, action);
  metadata.append(about);
  description.append(heading, metadata);
  row.append(citation, description);
  return row as HTMLElement;
}

test("rebind updates visible fields and reports whether the reference identity changed", () => {
  (globalThis as any).addon = {
    data: {
      locale: {
        current: {
          formatMessagesSync: ([{ id, args }]: any) => [
            { value: args?.page ? `${String(id).replace(/^refflow-/, "")}:${args.page}` : String(id).replace(/^refflow-/, "") },
          ],
        },
      },
    },
  };
  const first: ItemBaseInfo = { title: "Alpha", text: "Alpha", authors: ["A"], year: "2020", identifiers: {}, number: 1 };
  const second: ItemBaseInfo = {
    title: "Beta",
    text: "Beta",
    authors: ["B"],
    year: "2021",
    identifiers: { DOI: "10.1/b" },
    number: 2,
    page: "4",
  };
  const row = card(first);
  assert.equal(rebindReferenceCardRow(row, first, 3, 3, 10, true, undefined), false);
  assert.equal(row.getAttribute("aria-selected"), "true");
  assert.equal(row.querySelector(".reference-number")?.textContent, "3.");
  assert.equal(rebindReferenceCardRow(row, second, 4, 4, 10, false, undefined), true);
  assert.equal((row as any).reference, second);
  assert.equal(row.querySelector(".reference-title")?.textContent, "Beta");
  assert.equal(row.querySelector(".reference-number")?.title, "cards-locate-in-pdf:4");
  assert.equal((row.querySelector(".reference-number") as HTMLElement).style.cursor, "pointer");
  assert.equal(row.classList.contains("selected"), false);
});
