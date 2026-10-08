import "./setup";
import { test, describe } from "node:test";
import assert from "node:assert";
import GBT7714Parser from "../src/modules/parsers/gbt7714";

describe("GBT7714Parser Suite", () => {
  describe("isGBT7714", () => {
    test("should detect standard document type markers", () => {
      assert.strictEqual(GBT7714Parser.isGBT7714("李德毅, 杜鹢. 不确定性人工智能[J]. 软件学报, 2004."), true);
      assert.strictEqual(GBT7714Parser.isGBT7714("蒋有绪. 中国森林群落分类及其主要类型特征[M]. 科学出版社, 1998."), true);
      assert.strictEqual(GBT7714Parser.isGBT7714("贾东琴. 面向数字素养的高校图书馆教育研究[C]//中国图书馆学会. 2011."), true);
      assert.strictEqual(GBT7714Parser.isGBT7714("张志祥. 间歇式反应器控制系统研究[D]. 浙江大学, 1998."), true);
      assert.strictEqual(GBT7714Parser.isGBT7714("萧钰. 出版业信息化迈入快车道[EB/OL]. (2001-12-19)."), true);
      assert.strictEqual(GBT7714Parser.isGBT7714("冯西桥. 核反应堆压力管道的LBB分析[R]. 清华大学, 1997."), true);
    });

    test("should return false for references without GB/T markers", () => {
      assert.strictEqual(GBT7714Parser.isGBT7714("He K, Zhang X, Ren S, et al. Deep residual learning for image recognition. CVPR, 2016."), false);
      assert.strictEqual(GBT7714Parser.isGBT7714(""), false);
    });
  });

  describe("parse", () => {
    test("should parse standard Journal article [J]", () => {
      const raw = "[1] 李德毅, 杜鹢. 不确定性人工智能[J]. 软件学报, 2004, 15(11): 1583-1594.";
      const res = GBT7714Parser.parse(raw);
      assert.ok(res !== null);
      assert.deepStrictEqual(res.authors, ["李德毅", "杜鹢"]);
      assert.strictEqual(res.title, "不确定性人工智能");
      assert.strictEqual(res.type, "journalArticle");
      assert.strictEqual(res.year, "2004");
      assert.strictEqual(res.volume, "15");
      assert.strictEqual(res.issue, "11");
      assert.strictEqual(res.pages, "1583-1594");
    });

    test("should parse Monograph / Book [M]", () => {
      const raw = "[2] 蒋有绪, 郭泉水, 马克平, 等. 中国森林群落分类及其主要类型特征[M]. 北京: 科学出版社, 1998.";
      const res = GBT7714Parser.parse(raw);
      assert.ok(res !== null);
      assert.deepStrictEqual(res.authors, ["蒋有绪", "郭泉水", "马克平"]);
      assert.strictEqual(res.title, "中国森林群落分类及其主要类型特征");
      assert.strictEqual(res.type, "book");
      assert.strictEqual(res.year, "1998");
    });

    test("should parse Conference proceedings [C]", () => {
      const raw = "[3] 贾东琴, 柯平. 面向数字素养的高校图书馆信息素养教育研究[C]//中国图书馆学会. 2011: 45-49.";
      const res = GBT7714Parser.parse(raw);
      assert.ok(res !== null);
      assert.deepStrictEqual(res.authors, ["贾东琴", "柯平"]);
      assert.strictEqual(res.title, "面向数字素养的高校图书馆信息素养教育研究");
      assert.strictEqual(res.type, "conferencePaper");
      assert.strictEqual(res.year, "2011");
      assert.strictEqual(res.pages, "45-49");
    });

    test("should parse Dissertation / Thesis [D]", () => {
      const raw = "[4] 张志祥. 间歇式反应器控制系统研究[D]. 杭州: 浙江大学, 1998.";
      const res = GBT7714Parser.parse(raw);
      assert.ok(res !== null);
      assert.deepStrictEqual(res.authors, ["张志祥"]);
      assert.strictEqual(res.title, "间歇式反应器控制系统研究");
      assert.strictEqual(res.type, "thesis");
      assert.strictEqual(res.year, "1998");
    });

    test("should parse Electronic Bulletin / Webpage [EB/OL]", () => {
      const raw = "[5] 萧钰. 出版业信息化迈入快车道[EB/OL]. (2001-12-19)[2002-04-15]. http://www.creader.com/news/20011219/200112190019.html.";
      const res = GBT7714Parser.parse(raw);
      assert.ok(res !== null);
      assert.deepStrictEqual(res.authors, ["萧钰"]);
      assert.strictEqual(res.title, "出版业信息化迈入快车道");
      assert.strictEqual(res.type, "webpage");
      assert.strictEqual(res.year, "2001");
    });

    test("should extract embedded DOI from citation text", () => {
      const raw = "[6] 王敏. 深度学习在生物医学中的应用[J]. 计算机学报, 2021, 44(2): 300-315. doi: 10.11897/SP.J.1016.2021.00300.";
      const res = GBT7714Parser.parse(raw);
      assert.ok(res !== null);
      assert.strictEqual(res.doi, "10.11897/SP.J.1016.2021.00300");
    });

    test("should parse Western author with initial dots in GB/T format", () => {
      const raw = "[7] Smith J. A., Brown K. L. Superconductivity in graphene[J]. Phys. Rev. Lett., 2019, 122(5): 056801.";
      const res = GBT7714Parser.parse(raw);
      assert.ok(res !== null);
      assert.deepStrictEqual(res.authors, ["Smith J. A.", "Brown K. L."]);
      assert.strictEqual(res.title, "Superconductivity in graphene");
      assert.strictEqual(res.type, "journalArticle");
      assert.strictEqual(res.year, "2019");
      assert.strictEqual(res.pages, "056801");
    });

    test("should parse Chinese reference with Chinese full stop delimiter without space", () => {
      const raw = "[8] 李德毅, 杜鹢。不确定性人工智能[J]. 软件学报, 2004, 15(11): 1583-1594.";
      const res = GBT7714Parser.parse(raw);
      assert.ok(res !== null);
      assert.deepStrictEqual(res.authors, ["李德毅", "杜鹢"]);
      assert.strictEqual(res.title, "不确定性人工智能");
      assert.strictEqual(res.year, "2004");
      assert.strictEqual(res.source, "软件学报");
    });

    test("should cleanly extract journal venue, book publisher, and thesis university", () => {
      const jRaw = "李德毅, 杜鹢. 不确定性人工智能[J]. 软件学报, 2004, 15(11): 1583-1594.";
      assert.strictEqual(GBT7714Parser.parse(jRaw)?.source, "软件学报");

      const mRaw = "蒋有绪. 中国森林群落分类及其主要类型特征[M]. 北京: 科学出版社, 1998.";
      assert.strictEqual(GBT7714Parser.parse(mRaw)?.source, "科学出版社");

      const dRaw = "张志祥. 间歇式反应器控制系统研究[D]. 杭州: 浙江大学, 1998.";
      assert.strictEqual(GBT7714Parser.parse(dRaw)?.source, "浙江大学");

      const cRaw = "贾东琴. 面向数字素养的高校图书馆信息素养教育研究[C]//中国图书馆学会. 2011: 45-49.";
      assert.strictEqual(GBT7714Parser.parse(cRaw)?.source, "中国图书馆学会");
    });

    test("should parseLoose references without explicit [J]/[M] markers", () => {
      const looseRaw = "李德毅, 杜鹢. 不确定性人工智能. 软件学报, 2004.";
      const res = GBT7714Parser.parseLoose(looseRaw, undefined, looseRaw);
      assert.ok(res !== null);
      assert.deepStrictEqual(res.authors, ["李德毅", "杜鹢"]);
      assert.strictEqual(res.title, "不确定性人工智能");
      assert.strictEqual(res.year, "2004");
    });
  });
});
