import "./setup";
import { test, describe } from "node:test";
import assert from "node:assert";
import CitationVerifier, { CandidateWork } from "../src/modules/verifier";

describe("CitationVerifier Suite", () => {
  describe("normalizeDOI", () => {
    test("should normalize standard lowercase DOI", () => {
      assert.strictEqual(
        CitationVerifier.normalizeDOI("10.1038/s41586-020-2649-2"),
        "10.1038/s41586-020-2649-2"
      );
    });

    test("should normalize uppercase DOI to lowercase", () => {
      assert.strictEqual(
        CitationVerifier.normalizeDOI("10.1038/S41586-020-2649-2"),
        "10.1038/s41586-020-2649-2"
      );
    });

    test("should strip https://doi.org/ and http://dx.doi.org/ prefixes", () => {
      assert.strictEqual(
        CitationVerifier.normalizeDOI("https://doi.org/10.1038/s41586-020-2649-2"),
        "10.1038/s41586-020-2649-2"
      );
      assert.strictEqual(
        CitationVerifier.normalizeDOI("http://dx.doi.org/10.1038/s41586-020-2649-2"),
        "10.1038/s41586-020-2649-2"
      );
    });

    test("should strip doi: prefix and whitespace", () => {
      assert.strictEqual(
        CitationVerifier.normalizeDOI("doi: 10.1038/s41586-020-2649-2"),
        "10.1038/s41586-020-2649-2"
      );
    });

    test("should strip trailing periods, commas, and spaces", () => {
      assert.strictEqual(
        CitationVerifier.normalizeDOI("10.1038/s41586-020-2649-2. "),
        "10.1038/s41586-020-2649-2"
      );
      assert.strictEqual(
        CitationVerifier.normalizeDOI("10.1038/s41586-020-2649-2,"),
        "10.1038/s41586-020-2649-2"
      );
    });

    test("should strip trailing parentheses and brackets from citation references", () => {
      assert.strictEqual(
        CitationVerifier.normalizeDOI("(10.1038/s41586-020-2649-2)"),
        "10.1038/s41586-020-2649-2"
      );
      assert.strictEqual(
        CitationVerifier.normalizeDOI("[10.1038/s41586-020-2649-2]"),
        "10.1038/s41586-020-2649-2"
      );
    });

    test("should decode URI encoded characters in DOI", () => {
      assert.strictEqual(
        CitationVerifier.normalizeDOI("10.1016%2Fj.cell.2020.08.001"),
        "10.1016/j.cell.2020.08.001"
      );
    });

    test("should return undefined for invalid DOI strings", () => {
      assert.strictEqual(CitationVerifier.normalizeDOI(""), undefined);
      assert.strictEqual(CitationVerifier.normalizeDOI("not a doi"), undefined);
      assert.strictEqual(CitationVerifier.normalizeDOI(undefined), undefined);
    });
  });

  describe("cleanTitle", () => {
    test("should strip HTML and XML tags", () => {
      const dirty = "<i>Deep</i> Residual Learning for <jats:title>Image</jats:title> Recognition";
      assert.strictEqual(CitationVerifier.cleanTitle(dirty), "deep residual learning for image recognition");
    });

    test("should unescape common XML entities", () => {
      const dirty = "Attention &amp; &quot;Transformers&quot; &apos;Models&apos;";
      assert.strictEqual(CitationVerifier.cleanTitle(dirty), "attention transformers models");
    });

    test("should remove LaTeX math and symbols", () => {
      const dirty = "An $\\mathcal{O}(N)$ Framework with $\\alpha$ and {\\beta} Parameters";
      assert.strictEqual(CitationVerifier.cleanTitle(dirty), "an framework with and parameters");
    });

    test("should sanitize Chinese quotation marks and punctuation", () => {
      const dirty = "《基于深度学习的图像分类：“现状与展望”》";
      assert.strictEqual(CitationVerifier.cleanTitle(dirty), "基于深度学习的图像分类 现状与展望");
    });
  });

  describe("tokenize", () => {
    test("should extract clean English words and filter stopwords", () => {
      const tokens = CitationVerifier.tokenize("Deep Residual Learning for Image Recognition");
      assert.ok(tokens.has("deep"));
      assert.ok(tokens.has("residual"));
      assert.ok(tokens.has("learning"));
      assert.ok(tokens.has("image"));
      assert.ok(tokens.has("recognition"));
      assert.ok(!tokens.has("for")); // stopword
    });

    test("should extract Chinese characters and 2-grams", () => {
      const tokens = CitationVerifier.tokenize("深度学习在图像识别中的应用");
      // 单字
      assert.ok(tokens.has("深"));
      assert.ok(tokens.has("度"));
      assert.ok(tokens.has("学"));
      assert.ok(tokens.has("习"));
      // 2-gram
      assert.ok(tokens.has("深度"));
      assert.ok(tokens.has("度学"));
      assert.ok(tokens.has("学习"));
      assert.ok(tokens.has("图像"));
      assert.ok(tokens.has("识别"));
    });
  });

  describe("tokenJaccard", () => {
    test("should return 1.0 for identical titles", () => {
      const title = "Deep Residual Learning for Image Recognition";
      assert.strictEqual(CitationVerifier.tokenJaccard(title, title), 1.0);
    });

    test("should return high score for titles differing only by subtitle", () => {
      const t1 = "Deep Residual Learning for Image Recognition: A Comprehensive Study";
      const t2 = "Deep Residual Learning for Image Recognition";
      const sim = CitationVerifier.tokenJaccard(t1, t2);
      assert.ok(sim >= 0.88, `Expected sim >= 0.88, got ${sim}`);
    });

    test("should accurately calculate Chinese title similarity (2-gram enabled)", () => {
      const t1 = "基于深度学习的图像识别研究";
      const t2 = "基于深度学习的图像识别";
      const sim = CitationVerifier.tokenJaccard(t1, t2);
      assert.ok(sim >= 0.80, `Expected Chinese title sim >= 0.80, got ${sim}`);
    });

    test("should return low score for completely different titles", () => {
      const t1 = "Deep Residual Learning for Image Recognition";
      const t2 = "Quantum Computing and Post-Quantum Cryptography Schemes";
      const sim = CitationVerifier.tokenJaccard(t1, t2);
      assert.ok(sim < 0.20, `Expected low sim for different titles, got ${sim}`);
    });
  });

  describe("authorMatch", () => {
    test("should match exact surname token", () => {
      const score = CitationVerifier.authorMatch("He, Kaiming", ["Kaiming He", "Xiangyu Zhang"]);
      assert.strictEqual(score, 1.0);
    });

    test("should match Chinese author name", () => {
      const score = CitationVerifier.authorMatch("李德毅", ["李德毅", "杜鹢"]);
      assert.strictEqual(score, 1.0);
    });

    test("should match space-separated single-character Chinese surname", () => {
      const score = CitationVerifier.authorMatch("张 宁", ["张宁", "李明"]);
      assert.strictEqual(score, 1.0);
    });

    test("should prevent 2-letter surname false positives (e.g. Li vs Williams)", () => {
      const score = CitationVerifier.authorMatch("Li, B.", ["John Williams", "David Collins"]);
      assert.strictEqual(score, 0.0);
    });

    test("should return neutral 0.5 score when author is missing", () => {
      assert.strictEqual(CitationVerifier.authorMatch(undefined, ["John Doe"]), 0.5);
      assert.strictEqual(CitationVerifier.authorMatch("John Doe", undefined), 0.5);
      assert.strictEqual(CitationVerifier.authorMatch(undefined, undefined), 0.5);
    });
  });

  describe("yearMatch", () => {
    test("should return 1.0 for exact year match", () => {
      assert.strictEqual(CitationVerifier.yearMatch(2021, 2021), 1.0);
    });

    test("should return 0.75 for preprint/publication 1-year discrepancy", () => {
      assert.strictEqual(CitationVerifier.yearMatch(2020, 2021), 0.75);
      assert.strictEqual(CitationVerifier.yearMatch(2021, 2020), 0.75);
    });

    test("should return 0.0 for year difference >= 2", () => {
      assert.strictEqual(CitationVerifier.yearMatch(2018, 2022), 0.0);
    });

    test("should return neutral 0.6 when either year is missing", () => {
      assert.strictEqual(CitationVerifier.yearMatch(undefined, 2021), 0.6);
      assert.strictEqual(CitationVerifier.yearMatch(2021, undefined), 0.6);
    });
  });

  describe("evaluate matrix", () => {
    test("should immediately ACCEPT on exact DOI match", () => {
      const extracted = {
        title: "Some Paper",
        doi: "10.1038/s41586-020-2649-2"
      };
      const candidate: CandidateWork = {
        title: "Different Title in DB",
        doi: "10.1038/s41586-020-2649-2"
      };
      const result = CitationVerifier.evaluate(extracted, candidate);
      assert.strictEqual(result.status, "ACCEPT");
      assert.strictEqual(result.score, 1.0);
    });

    test("should ACCEPT high quality metadata match (score >= 0.85)", () => {
      const extracted = {
        title: "Deep Residual Learning for Image Recognition",
        author: "He, Kaiming",
        year: 2016
      };
      const candidate: CandidateWork = {
        title: "Deep Residual Learning for Image Recognition",
        authors: ["Kaiming He", "Xiangyu Zhang"],
        year: 2016,
        doi: "10.1109/cvpr.2016.90"
      };
      const result = CitationVerifier.evaluate(extracted, candidate);
      assert.strictEqual(result.status, "ACCEPT");
      assert.ok(result.score >= 0.85);
    });

    test("should REJECT when title similarity is below hard threshold 0.65", () => {
      const extracted = {
        title: "Attention Is All You Need",
        author: "Vaswani",
        year: 2017
      };
      const candidate: CandidateWork = {
        title: "BERT: Pre-training of Deep Bidirectional Transformers",
        authors: ["Ashish Vaswani"],
        year: 2017
      };
      const result = CitationVerifier.evaluate(extracted, candidate);
      assert.strictEqual(result.status, "REJECT");
    });
  });
});
