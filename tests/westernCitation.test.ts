import "./setup";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import WesternCitationParser from "../src/modules/parsers/westernCitation";
import ReferenceParser from "../src/modules/referenceParser";

describe("Western Citation Styles & Identifier Detection", () => {
  test("IEEE style parses title in quotes, initials, venue, vol, no, pp and year", () => {
    const raw = `[1] J. K. Author and A. B. Researcher, "A novel framework for deep generative models," IEEE Trans. Neural Netw. Learn. Syst., vol. 32, no. 4, pp. 1420-1432, 2021, doi: 10.1109/TNNLS.2020.2987654.`;
    const res = WesternCitationParser.parseIEEE(raw);
    assert.ok(res);
    assert.equal(res.style, "IEEE");
    assert.equal(res.title, "A novel framework for deep generative models");
    assert.equal(res.year, "2021");
    assert.equal(res.volume, "32");
    assert.equal(res.issue, "4");
    assert.equal(res.pages, "1420-1432");
    assert.equal(res.doi, "10.1109/tnnls.2020.2987654");
    assert.deepEqual(res.authors, ["J. K. Author", "A. B. Researcher"]);
  });

  test("APA style parses parenthetical year, authors, title, venue, volume, issue, pages", () => {
    const raw = `Vaswani, A., Shazeer, N., & Parmar, N. (2017). Attention is all you need. Advances in Neural Information Processing Systems, 30(2), 5998–6008. https://doi.org/10.5555/3295222.3295349`;
    const res = WesternCitationParser.parseAPA(raw);
    assert.ok(res);
    assert.equal(res.style, "APA");
    assert.equal(res.title, "Attention is all you need");
    assert.equal(res.year, "2017");
    assert.equal(res.publicationVenue, "Advances in Neural Information Processing Systems");
    assert.equal(res.volume, "30");
    assert.equal(res.issue, "2");
    assert.equal(res.doi, "10.5555/3295222.3295349");
    assert.ok(res.authors.some((a) => a.includes("Vaswani")));
  });

  test("Vancouver / AMA style parses Year;Vol(Issue):Pages and unpunctuated initials", () => {
    const raw = `12. Smith JK, Doe AB, Johnson C. Genomic epidemiology of respiratory pathogens. Lancet Infect Dis. 2022;22(5):612-620.`;
    const res = WesternCitationParser.parseVancouver(raw);
    assert.ok(res);
    assert.equal(res.style, "Vancouver");
    assert.equal(res.title, "Genomic epidemiology of respiratory pathogens");
    assert.equal(res.year, "2022");
    assert.equal(res.volume, "22");
    assert.equal(res.issue, "5");
    assert.equal(res.pages, "612-620");
    assert.equal(res.publicationVenue, "Lancet Infect Dis");
    assert.deepEqual(res.authors, ["Smith JK", "Doe AB", "Johnson C"]);
  });

  test("MLA style parses author, quoted title, venue, vol, no, year and pp", () => {
    const raw = `Kafka, Franz. "The Metamorphosis." Modern European Fiction, vol. 14, no. 2, 2018, pp. 210-230.`;
    const res = WesternCitationParser.parseMLA(raw);
    assert.ok(res);
    assert.equal(res.style, "MLA");
    assert.equal(res.title, "The Metamorphosis");
    assert.equal(res.year, "2018");
    assert.equal(res.volume, "14");
    assert.equal(res.issue, "2");
    assert.equal(res.pages, "210-230");
  });

  test("ReferenceParser integrates WesternCitationParser automatically in refText2Info", () => {
    const raw = `[3] Devlin, J., Chang, M. W., Lee, K., & Toutanova, K. (2019). BERT: Pre-training of deep bidirectional transformers for language understanding. NAACL-HLT, 1, 4171-4186.`;
    const info = ReferenceParser.refText2Info(raw);
    assert.equal(info.title, "BERT: Pre-training of deep bidirectional transformers for language understanding");
    assert.equal(info.year, "2019");
    assert.ok(info.authors.length >= 1);
  });

  test("ReferenceParser identifies PMID, PMCID, and ISBN correctly", () => {
    const textPMID = "Study on mRNA vaccines. PMID: 33301246 PMCID: PMC7745181";
    const ids1 = ReferenceParser.getIdentifiers(textPMID) as any;
    assert.equal(ids1.PMID, "33301246");
    assert.equal(ids1.PMCID, "PMC7745181");
    assert.equal(ReferenceParser.identifiers2URL(ids1), "https://pubmed.ncbi.nlm.nih.gov/33301246/");

    const textISBN = "Deep Learning Book. ISBN 978-0262035613";
    const ids2 = ReferenceParser.getIdentifiers(textISBN) as any;
    assert.equal(ids2.ISBN, "9780262035613");
  });
});
