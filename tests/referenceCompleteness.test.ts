import "./setup";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import API from "../src/modules/api";
import PDF from "../src/modules/pdf";
import { textItemsToLines } from "../src/modules/pdfLayout";
import { extractReferencesFromLines } from "../src/modules/referenceExtractor";
import { onlineReferences, smartReferences } from "../src/modules/referencePipeline";

const run = (str: string, x: number, y: number, width: number, height = 10) => ({
  str,
  width,
  height,
  transform: [height, 0, 0, height, x, y],
});

describe("Reference completeness & PDF column/script extraction", () => {
  test("mid-line italic/number runs past 0.45*pageWidth do not create a false column split", () => {
    const pageWidth = 595;
    const items = [
      run("References", 45, 760, 60),
      run("1. Siemens, M. E., Moody, G. & Cundiff, S. T.", 45, 735, 225),
      run("Opt. Express", 272, 735, 58),
      run("18, 17699-17708 (2010).", 333, 735, 110),
      run("2. Moody, G. et al. Coherent Coupling.", 45, 715, 220),
      run("Phys. Rev. Lett.", 268, 715, 68),
      run("112, 146801 (2014).", 339, 715, 95),
      run("3. Liu, C. H. et al. Trion-Induced Negative Photoconductivity.", 45, 695, 235),
      run("Phys. Rev. Lett.", 283, 695, 68),
      run("113, 166801 (2014).", 354, 695, 95),
    ];

    const lines = textItemsToLines(items, 1, pageWidth, 842);
    const refs = extractReferencesFromLines(lines);
    assert.equal(refs.length, 3);
    assert.ok(refs[0].text.includes("Opt. Express 18, 17699-17708 (2010)"));
    assert.ok(!refs[2].text.includes("Opt. Express"));
    assert.ok(refs[1].text.includes("Phys. Rev. Lett. 112, 146801 (2014)"));
  });

  test("narrow 11pt two-column gutters remain cleanly separated", () => {
    const pageWidth = 595;
    const items = [
      run("References", 40, 760, 60),
      run("1. Alpha, A. First left paper. Nature, 2021.", 40, 735, 250),
      run("2. Beta, B. Second left paper. Science, 2022.", 40, 715, 250),
      run("3. Gamma, C. First right paper. PRL, 2023.", 301, 735, 240),
      run("4. Delta, D. Second right paper. Nat. Phys., 2024.", 301, 715, 240),
    ];

    const refs = extractReferencesFromLines(textItemsToLines(items, 1, pageWidth, 842));
    assert.deepEqual(refs.map(r => r.number), [1, 2, 3, 4]);
    assert.ok(refs[0].text.includes("Alpha"));
    assert.ok(refs[2].text.includes("Gamma"));
  });

  test("inline subscripts (MoS2) and leading superscript numbers stay attached", () => {
    const items = [
      run("References", 40, 760, 60),
      run("1", 40, 738, 4, 6),
      run("Liu, C. H. et al. Monolayer MoS", 50, 735, 160, 10),
      run("2", 210.5, 732.5, 4, 6),
      run(". Phys. Rev. Lett. 113, 166801 (2014).", 215, 735, 170, 10),
      run("2", 40, 718, 4, 6),
      run("Smith, J. Second work. Nature, 2023.", 50, 715, 180, 10),
    ];

    const refs = extractReferencesFromLines(textItemsToLines(items, 1, 612, 792));
    assert.equal(refs.length, 2);
    assert.equal(refs[0].number, 1);
    assert.ok(refs[0].text.includes("MoS2."));
    assert.equal(refs[1].number, 2);
  });

  test("reference titles starting with section keywords do not truncate later references", () => {
    const refs = extractReferencesFromLines([
      { page: 1, y: 760, text: "References" },
      { page: 1, y: 740, text: "1. Smith, J. First citation. Nature, 2021." },
      { page: 1, y: 720, text: "2. Brown, A. Next paper on" },
      { page: 1, y: 705, text: "Methods for scalable quantum readout. Science, 2022." },
      { page: 1, y: 685, text: "3. Lee, K. Third citation. Nature Photonics, 2024." },
      { page: 1, y: 660, text: "Acknowledgements" },
      { page: 1, y: 640, text: "We thank our colleagues for helpful discussions." },
    ]);

    assert.deepEqual(refs.map(r => r.number), [1, 2, 3]);
    assert.ok(!refs[2].text.includes("colleagues"));
  });

  test("PDF backwards scan continues past a short trailing Methods reference list to recover main bibliography", async () => {
    const sdtRow = (text: string, pageIndex: number, y: number) => ({
      text,
      anchor: { textMap: JSON.stringify([[0, pageIndex, 40, y, 540, y + 10, ...Array.from(text.replace(/\s/g, "")).map(() => 5)]]) },
    });

    const pagesBlocks = [
      // Page 0: Main body
      [sdtRow("1. Introduction", 0, 750)],
      // Page 1: Main References (1..12)
      [
        sdtRow("References", 1, 760),
        ...Array.from({ length: 12 }, (_, i) =>
          sdtRow(`${i + 1}. Main Author ${i + 1}. Main paper ${i + 1}. Nature, 202${i % 4}.`, 1, 730 - i * 24)
        ),
      ],
      // Page 2: Methods prose
      [sdtRow("Methods", 2, 750), sdtRow("Sample preparation details.", 2, 720)],
      // Page 3: Short Methods References (1..3)
      [
        sdtRow("References", 3, 760),
        sdtRow("1. Method Author 1. Method ref 1. Rev. Sci. Instrum., 2020.", 3, 735),
        sdtRow("2. Method Author 2. Method ref 2. Rev. Sci. Instrum., 2021.", 3, 710),
        sdtRow("3. Method Author 3. Method ref 3. Rev. Sci. Instrum., 2022.", 3, 685),
      ],
    ];

    const host: any = Zotero;
    const original = host.SDT;
    host.SDT = {
      getReader: async () => ({
        header: { schemaVersion: "1.2.0" },
        getCatalog: async () => ({ pages: pagesBlocks.map(() => ({ viewRect: [0, 0, 612, 792] })) }),
        getPageBlocks: async (idx: number) => pagesBlocks[idx] || [],
      }),
    };
    const pdf = new PDF({ refText2Info: (t: string) => ({ title: t, identifiers: {} }) } as any);
    const attachment: any = { id: 77, attachmentContentType: "application/pdf", getAttachmentLastPageIndex: () => 3 };

    try {
      const refs = await pdf.getReferences(attachment, false, { notify: false });
      assert.equal(refs.length, 15);
      assert.ok(refs.some(r => r.text.includes("Main paper 12")));
      assert.equal(pdf.getDiagnostics(attachment)?.scanLimited, false);
    } finally {
      host.SDT = original;
    }
  });

  test("single-item OpenAlex list without Crossref reference-count escalates to Semantic Scholar", async () => {
    const api = new API({
      refText2Info: (t: string) => ({ title: t }),
      identifiers2URL: (id: any) => (id?.DOI ? `https://doi.org/${id.DOI}` : undefined),
    } as any);
    (api.requests as any).get = async () => ({ message: { DOI: "10.48550/arXiv.2401.00001", title: ["Parent"] } });
    (api.openAlex as any).getWorkByDOI = async () => ({ work: { title: "Parent" }, referencedWorks: ["W1"] });
    (api.openAlex as any).hydrateBatch = async () => [{ openalexId: "https://openalex.org/W1", title: "Only One OA", authors: ["A"], year: "2024", isOA: false }];
    let s2Calls = 0;
    (api as any).getDOIReferenceListBySemanticScholar = async () => {
      s2Calls++;
      return {
        source: "SemanticScholar",
        partial: false,
        references: Array.from({ length: 24 }, (_, i) => ({
          title: `S2 Ref ${i + 1}`,
          identifiers: {},
          authors: ["Author"],
          sources: ["SemanticScholar"],
        })),
      };
    };

    try {
      const info = await api.getDOIInfoByCrossref("10.48550/arXiv.2401.00001");
      assert.equal(s2Calls, 1);
      assert.equal(info?.references?.length, 24);
      assert.equal(info?.referencePartial, false);
    } finally {
      api.requests.dispose();
      api.publisherReferences.dispose();
    }
  });

  test("Auto mode replaces a suspicious 1-3 item PDF extract when Online returns the full bibliography", async () => {
    const controller = new AbortController();
    const task: any = { signal: controller.signal, isCurrent: () => true };
    const item: any = {
      id: 500,
      getField: (f: string) => ({ title: "MoSe2 Trions", DOI: "10.1234/trion", url: "", date: "2024" }[f] || ""),
      getCreators: () => [{ lastName: "Rosa" }],
      getAttachments: () => [],
    };
    const views: any = {
      pdfAttachment: async () => ({ id: 501, attachmentContentType: "application/pdf" }),
      utils: {
        isDOI: (v: string) => Boolean(v),
        PDF: {
          getReferences: async () => [
            { number: 1, title: "Partial Ref 1", identifiers: {}, authors: [] },
            { number: 2, title: "Partial Ref 2", identifiers: {}, authors: [] },
            { number: 3, title: "Partial Ref 3", identifiers: {}, authors: [] },
          ],
          getDiagnostics: () => ({ scanLimited: false, headingFound: true, pagesRead: 2, totalPages: 10, elapsedMs: 5 }),
        },
        API: {
          publisherReferences: { parseHTML: () => [] },
        },
      },
      onlineReferences: async () => ({
        source: "Crossref",
        partial: false,
        references: Array.from({ length: 30 }, (_, i) => ({
          number: i + 1,
          title: `Full Online Ref ${i + 1}`,
          identifiers: {},
          authors: ["Smith"],
        })),
      }),
    };

    const result = await smartReferences(views, item, undefined, task, true, false, { textContent: "" } as any);
    assert.equal(result.source, "Crossref");
    assert.equal(result.references.length, 30);
    assert.equal(result.partial, false);
  });

  test("onlineReferences uses Semantic Scholar ARXIV fallback when DOI lookup has no references", async () => {
    const controller = new AbortController();
    const task: any = { signal: controller.signal, isCurrent: () => true };
    const item: any = {
      getField: (f: string) => ({ title: "Preprint", DOI: "", url: "https://arxiv.org/abs/2405.12345v1", date: "2024" }[f] || ""),
      getCreators: () => [{ lastName: "Tester" }],
    };
    let s2Key = "";
    const views: any = {
      utils: {
        parseCNKIURL: () => undefined,
        isChinese: () => false,
        matchArXiv: (v: string) => (v.match(/arxiv\.org\/abs\/(\d{4}\.\d{5}(?:v\d+)?)/i)?.[1]) || false,
        API: {
          resolveWork: async () => undefined,
          semanticScholar: {
            neighborhood: async (id: string) => {
              s2Key = id;
              return {
                source: "SemanticScholar",
                partial: false,
                references: [{ title: "ArXiv Ref 1", identifiers: {}, authors: [] }],
              };
            },
          },
        },
      },
    };

    const result = await onlineReferences(views, item, task, { textContent: "" } as any);
    assert.equal(s2Key, "ARXIV:2405.12345v1");
    assert.equal(result?.references.length, 1);
  });

  test("right-column references above a lower-left References heading are preserved in reading order", () => {
    const pageWidth = 595;
    const items = [
      run("We conclude our measurements and thank funding agencies.", 45, 740, 220),
      run("References", 45, 420, 60),
      run("1. Alpha, A. Left lower one. Nature, 2021.", 45, 390, 210),
      run("2. Beta, B. Left lower two. Science, 2022.", 45, 360, 210),
      run("3. Gamma, C. Left lower three. PRL, 2023.", 45, 330, 210),
      run("4. Delta, D. Right upper one. Nat. Phys., 2020.", 310, 740, 220),
      run("5. Epsilon, E. Right upper two. Optica, 2021.", 310, 700, 220),
      run("6. Zeta, F. Right lower one. Phys. Rev. B, 2024.", 310, 390, 220),
    ];

    const refs = extractReferencesFromLines(textItemsToLines(items, 1, pageWidth, 842));
    assert.deepEqual(refs.map(r => r.number), [1, 2, 3, 4, 5, 6]);
    assert.ok(refs[3].text.includes("Delta"));
    assert.ok(refs[4].text.includes("Epsilon"));
  });

  test("centered References heading spanning column split retains both columns", () => {
    const pageWidth = 595;
    const items = [
      run("References", 275, 750, 55),
      run("1. Alpha, A. Left column entry. Nature, 2021.", 45, 720, 220),
      run("2. Beta, B. Right column entry. Science, 2022.", 310, 720, 220),
    ];

    const refs = extractReferencesFromLines(textItemsToLines(items, 1, pageWidth, 842));
    assert.deepEqual(refs.map(r => r.number), [1, 2]);
  });

  test("tight leading superscript numbers and letterspaced headings extract without truncation", () => {
    const items = [
      run("R E F E R E N C E S", 40, 760, 120),
      run("1", 40, 738, 4, 6),
      run("Liu, C. H. Tight superscript work. Nature, 2021.", 44.5, 735, 220, 10),
      run("(2021).", 45, 720, 35, 10),
      run("2", 40, 703, 4, 6),
      run("Moody, G. Second tight superscript. PRL", 44.5, 700, 190, 10),
      run("12 (2022) 100-110.", 45, 685, 95, 10),
    ];

    const refs = extractReferencesFromLines(textItemsToLines(items, 1, 612, 792));
    assert.deepEqual(refs.map(r => r.number), [1, 2]);
    assert.ok(refs[0].text.includes("(2021)."));
    assert.ok(refs[1].text.includes("12 (2022) 100-110."));
  });

  test("PDF extraction extends past 80 trailing supplementary pages to recover main references", async () => {
    const sdtRow = (text: string, pageIndex: number, y: number) => ({
      text,
      anchor: { textMap: JSON.stringify([[0, pageIndex, 40, y, 540, y + 10, ...Array.from(text.replace(/\s/g, "")).map(() => 5)]]) },
    });
    const host: any = Zotero;
    const originalSDT = host.SDT;
    host.SDT = {
      getReader: async () => ({
        header: { schemaVersion: "1.2.0" },
        getCatalog: async () => ({
          pages: Array.from({ length: 110 }, () => ({ viewRect: [0, 0, 612, 792] })),
        }),
        getPageBlocks: async (pageIndex: number) => {
          if (pageIndex === 14) {
            return [
              sdtRow("References", 14, 760),
              ...Array.from({ length: 12 }, (_, idx) =>
                sdtRow(`${idx + 1}. Author ${idx + 1}. Main bibliography paper. Nature, 202${idx % 5}.`, 14, 735 - idx * 20)
              ),
            ];
          }
          return [sdtRow(`Supplementary Figure ${pageIndex + 1}`, pageIndex, 700)];
        },
      }),
    };
    try {
      const pdf = new PDF({ refText2Info: (t: string) => ({ title: t, identifiers: {}, authors: [] }) } as any);
      const attachment: any = {
        id: 8002,
        deleted: false,
        attachmentContentType: "application/pdf",
        getAttachmentLastPageIndex: () => 109,
      };
      const refs = await pdf.getReferences(attachment, false, { notify: false });
      assert.equal(refs.length, 12);
      assert.equal(refs[0].number, 1);
      assert.equal(refs[11].number, 12);
    } finally {
      host.SDT = originalSDT;
    }
  });

  test("uncorroborated small OpenAlex list still triggers publisher fallback when Semantic Scholar returns 0", async () => {
    const api = new API({ refText2Info: (t: string) => ({ title: t }), identifiers2URL: () => undefined } as any);
    (api.requests as any).get = async () => ({ message: { DOI: "10.1000/new-paper", title: ["New Paper"] } });
    (api.openAlex as any).getWorkByDOI = async () => ({ work: { title: "New Paper" }, referencedWorks: ["W1"] });
    (api.openAlex as any).hydrateBatch = async () => [{ openalexId: "W1", title: "Only One Indexed Ref", authors: ["Rosa"], year: "2024", doi: "10.1000/r1" }];
    (api as any).getDOIReferenceListBySemanticScholar = async () => ({ source: "SemanticScholar", references: [], partial: false, status: "empty" });
    let publisherCalls = 0;
    (api.publisherReferences as any).getReferences = async () => {
      publisherCalls++;
      return Array.from({ length: 20 }, (_, i) => ({
        number: i + 1,
        title: `Publisher Ref ${i + 1}`,
        identifiers: {},
        authors: [],
        sources: ["Nature / Springer HTML"],
      }));
    };
    try {
      const result = await api.getReferenceList("10.1000/new-paper", "https://www.nature.com/articles/test", "New Paper");
      assert.equal(publisherCalls, 1);
      assert.equal(result.references.length, 20);
      assert.equal(result.source, "Nature / Springer HTML");
    } finally {
      api.requests.dispose();
      api.publisherReferences.dispose();
    }
  });
});
