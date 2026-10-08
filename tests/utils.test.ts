import "./setup";
import { test, describe } from "node:test";
import assert from "node:assert";
import Utils from "../src/modules/utils";

describe("Utils Suite", () => {
  const utils = new Utils();

  describe("splitCreator", () => {
    test("should split Western names 'First Last'", () => {
      const creator = utils.splitCreator("Kaiming He");
      assert.strictEqual(creator.firstName, "Kaiming");
      assert.strictEqual(creator.lastName, "He");
      assert.strictEqual(creator.creatorType, "author");
    });

    test("should split Western names 'Last, First'", () => {
      const creator = utils.splitCreator("He, Kaiming");
      assert.strictEqual(creator.firstName, "Kaiming");
      assert.strictEqual(creator.lastName, "He");
    });

    test("should keep single name / Chinese name as lastName", () => {
      const creator = utils.splitCreator("张三");
      assert.strictEqual(creator.lastName, "张三");
      assert.strictEqual(creator.firstName, undefined);
    });

    test("should handle empty string defensively", () => {
      const creator = utils.splitCreator("");
      assert.strictEqual(creator.name, "Unknown");
    });
  });

  describe("isDOI", () => {
    test("should identify valid DOI strings in various formats", () => {
      assert.strictEqual(utils.isDOI("10.1038/s41586-020-2649-2"), true);
      assert.strictEqual(utils.isDOI("https://doi.org/10.1038/s41586-020-2649-2"), true);
      assert.strictEqual(utils.isDOI("doi: 10.1038/s41586-020-2649-2"), true);
    });

    test("should reject non-DOI strings and ISSN/CNKI tokens", () => {
      assert.strictEqual(utils.isDOI("random string"), false);
      assert.strictEqual(utils.isDOI("10.1000/cnki.123"), false);
      assert.strictEqual(utils.isDOI(""), false);
    });
  });

  describe("URL Regex & extractURL", () => {
    test("should extract URL without truncating at domain dots", () => {
      const text = "Available at https://doi.org/10.1038/nature12373. Accessed in 2021.";
      const res = (utils as any).extractURL(text);
      assert.strictEqual(res, "https://doi.org/10.1038/nature12373");
    });

    test("should clean trailing semicolons or brackets from extracted URL", () => {
      const text = "See: [http://www.creader.com/news/article.html];";
      const res = (utils as any).extractURL(text);
      assert.strictEqual(res, "http://www.creader.com/news/article.html");
    });
  });

  describe("isChinese", () => {
    test("should accurately detect Chinese text", () => {
      assert.strictEqual(utils.isChinese("基于深度学习的图像分类研究"), true);
      assert.strictEqual(utils.isChinese("Deep Residual Learning for Image Recognition"), false);
    });
  });

  describe("refText2Info", () => {
    test("does not consume journal text after a DOI",()=>{
      assert.equal(utils.getIdentifiers('DOI: 10.1234/example. Journal A 2024').DOI,'10.1234/example');
    });
    test("should parse GB/T 7714 references into structured ItemBaseInfo", () => {
      const text = "[1] 李德毅, 杜鹢. 不确定性人工智能[J]. 软件学报, 2004, 15(11): 1583-1594.";
      const info = utils.refText2Info(text);
      assert.strictEqual(info.title, "不确定性人工智能");
      assert.deepStrictEqual(info.authors, ["李德毅", "杜鹢"]);
      assert.strictEqual(info.type, "journalArticle");
      assert.strictEqual(info.year, "2004");
    });

    test("should detect arXiv identifiers in reference text", () => {
      const text = "Vaswani et al. Attention is all you need. arXiv:1706.03762, 2017.";
      const info = utils.refText2Info(text);
      assert.strictEqual(info.identifiers.arXiv, "1706.03762");
      assert.strictEqual(info.type, "preprint");
    });
  });

  describe("getItemType", () => {
    test("should return itemType when available as property", () => {
      const item = { itemType: "journalArticle" } as any;
      assert.strictEqual(utils.getItemType(item), "journalArticle");
    });

    test("should resolve itemType from itemTypeID via Zotero.ItemTypes", () => {
      const item = { itemTypeID: 2 } as any;
      assert.strictEqual(utils.getItemType(item), "book");
    });

    test("should handle undefined item gracefully", () => {
      assert.strictEqual(utils.getItemType(undefined as any), undefined);
    });
  });

  describe("Html2Text", () => {
    test("should strip HTML tags correctly", () => {
      const html = "<i>Deep</i> <b>Learning</b>";
      assert.strictEqual(utils.Html2Text(html), "Deep Learning");
    });

    test("should handle empty or null string", () => {
      assert.strictEqual(utils.Html2Text(""), "");
    });
  });
});
