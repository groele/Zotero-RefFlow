import { test, describe } from "node:test";
import assert from "node:assert";
import { extractReferencesFromLines } from "../src/modules/referenceExtractor";

describe("Reference text extraction", () => {
  test("extracts numbered bibliography entries and joins wrapped lines", () => {
    const refs = extractReferencesFromLines([
      { page: 1, y: 800, text: "Introduction" },
      { page: 7, y: 720, text: "References" },
      { page: 7, y: 700, text: "[1] Author A. A stable reference extraction method. Journal, 2024." },
      { page: 7, y: 684, text: "https://doi.org/10.1234/example" },
      { page: 7, y: 660, text: "[2] Author B. A second reference. Another Journal, 2023." },
    ]);

    assert.equal(refs.length, 2);
    assert.equal(refs[0].number, 1);
    assert.match(refs[0].text, /stable reference extraction method.*doi\.org/);
    assert.equal(refs[1].number, 2);
  });

  test("recognizes Chinese references and the first numeric item", () => {
    const refs = extractReferencesFromLines([
      { page: 2, y: 420, text: "参考文献" },
      { page: 2, y: 400, text: "［1］张三. 一种稳定的参考文献提取方法[J]. 2024." },
    ]);
    assert.equal(refs.length, 1);
    assert.equal(refs[0].number, 1);
  });

  test("does not interpret a short numbered body as a bibliography", () => {
    const refs = extractReferencesFromLines([
      { page: 1, y: 700, text: "1. First short point" },
      { page: 1, y: 680, text: "2. Second short point" },
    ]);
    assert.deepEqual(refs, []);
  });
});
