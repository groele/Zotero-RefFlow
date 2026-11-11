import "./setup";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { countInTextMentions, navigateToPdfReference } from "../src/modules/readerNavigation";

describe("Reader Navigation & Mention Counter", () => {
  test("countInTextMentions parses single numbers, ranges, and lists before bibliography heading", () => {
    const lines = [
      { page: 1, y: 700, text: "As shown in recent studies [1], deep architectures succeed." },
      { page: 1, y: 680, text: "Earlier results [2, 4] and [3-5] showed comparable performance." },
      { page: 2, y: 700, text: "References" },
      { page: 2, y: 680, text: "[1] Smith J. Paper One. 2021." },
      { page: 2, y: 660, text: "[2] Doe A. Paper Two. 2022." },
      { page: 2, y: 640, text: "[3] Lee K. Paper Three. 2023." },
      { page: 2, y: 620, text: "[4] Wang Y. Paper Four. 2024." },
      { page: 2, y: 600, text: "[5] Brown C. Paper Five. 2025." }
    ];
    const extracted = [
      { text: "[1] Smith J. Paper One. 2021.", number: 1, page: 2, y: 680 },
      { text: "[2] Doe A. Paper Two. 2022.", number: 2, page: 2, y: 660 },
      { text: "[3] Lee K. Paper Three. 2023.", number: 3, page: 2, y: 640 },
      { text: "[4] Wang Y. Paper Four. 2024.", number: 4, page: 2, y: 620 },
      { text: "[5] Brown C. Paper Five. 2025.", number: 5, page: 2, y: 600 }
    ];

    const counts = countInTextMentions(lines, extracted);
    // [1] was mentioned once
    assert.equal(counts.get(0), 1);
    // [2] was mentioned in [2, 4]
    assert.equal(counts.get(1), 1);
    // [3] was mentioned in [3-5]
    assert.equal(counts.get(2), 1);
    // [4] was mentioned in [2, 4] and in [3-5]
    assert.equal(counts.get(3), 2);
    // [5] was mentioned in [3-5]
    assert.equal(counts.get(4), 1);
  });

  test("navigateToPdfReference navigates to reader page when viewer is available", async () => {
    let scrolledPage: any = null;
    const mockPdfViewer = {
      scrollPageIntoView: (opts: any) => {
        scrolledPage = opts;
      }
    };
    const mockReader = {
      itemID: 10,
      _internalReader: {
        _primaryView: {
          _iframeWindow: {
            PDFViewerApplication: {
              pdfViewer: mockPdfViewer
            }
          }
        }
      }
    };

    const mockViews: any = {
      utils: {
        getReader: () => mockReader
      },
      pdfAttachment: async () => ({ id: 10 })
    };

    const ref = {
      title: "Sample paper",
      authors: ["Smith"],
      identifiers: {},
      page: 15,
      y: 650,
      x: 45
    };

    const parent: any = { id: 1 };
    const success = await navigateToPdfReference(mockViews, parent, ref);
    assert.equal(success, true);
    assert.equal(scrolledPage.pageNumber, 15);
  });
});
