import { test } from "node:test";
import assert from "node:assert/strict";
import Views from "../src/modules/views";

test("Views ensures section has label Zotero RefFlow and separates summary", async () => {
  const views = new Views();

  const titleEl: any = { textContent: "" };
  const summaryEl: any = { textContent: "", style: { display: "none" } };
  const section: any = {
    getAttribute: (attr: string) => (attr === "label" ? section.label : attr === "summary" ? section.summary : null),
    setAttribute: (attr: string, val: string) => {
      if (attr === "label") section.label = val;
      if (attr === "summary") section.summary = val;
    },
    removeAttribute: (attr: string) => {
      if (attr === "summary") delete section.summary;
    },
    querySelector: (sel: string) => {
      if (sel.includes("summary")) return summaryEl;
      if (sel.includes(".title") || sel.includes("title")) return titleEl;
      return null;
    },
    label: "",
    summary: "",
  };

  const body: any = {
    closest: (sel: string) => (sel === "collapsible-section" ? section : null),
    parentElement: section,
    ownerDocument: {
      querySelector: () => null,
      createElement: () => ({ className: "", style: {} }),
      createElementNS: () => ({ className: "", style: {} }),
      getElementById: () => null,
    },
  };

  // Initially ensure section title
  views.ensureSectionTitle(body);
  assert.equal(section.label, "Zotero RefFlow");
  assert.equal(titleEl.textContent, "Zotero RefFlow");

  // If a legacy or dynamic update overwrote the title with "49 篇参考文献", ensureSectionTitle repairs it
  titleEl.textContent = "49 篇参考文献";
  views.ensureSectionTitle(body);
  assert.equal(titleEl.textContent, "Zotero RefFlow");

  // updateSectionSummary sets summary without touching the main title
  let sectionSummaryCallbackVal = "";
  (body as any)._setSectionSummary = (val: string) => {
    sectionSummaryCallbackVal = val;
  };

  views.updateSectionSummary(body, "49 篇参考文献");
  assert.equal(section.summary, "49 篇参考文献");
  assert.equal(summaryEl.textContent, "49 篇参考文献");
  assert.equal(summaryEl.style.display, "");
  assert.equal(sectionSummaryCallbackVal, "49 篇参考文献");
  assert.equal(titleEl.textContent, "Zotero RefFlow");

  // Empty summary hides summary element and removes attribute
  views.updateSectionSummary(body, "");
  assert.equal(section.summary, undefined);
  assert.equal(summaryEl.style.display, "none");
  assert.equal(titleEl.textContent, "Zotero RefFlow");
});
