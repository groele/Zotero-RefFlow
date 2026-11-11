import type Views from "./views";
import type { ExtractedReference, ReferenceTextLine } from "./referenceExtractor";
import { isBibliographyHeading } from "./referenceExtractor";

/**
 * Counts in-text citation mentions (e.g. [1], [2, 4], [3-6], or Author (Year))
 * in the body lines preceding the bibliography section.
 */
export function countInTextMentions(
  lines: ReferenceTextLine[],
  extracted: ExtractedReference[]
): Map<number, number> {
  const counts = new Map<number, number>();
  if (!lines.length || !extracted.length) return counts;

  const headingIdx = lines.findIndex((line) => isBibliographyHeading(line.text));
  const bodyLines = headingIdx > 0 ? lines.slice(0, headingIdx) : [];
  if (!bodyLines.length) return counts;

  const numToIndex = new Map<number, number>();
  for (let i = 0; i < extracted.length; i++) {
    const num = extracted[i].number;
    if (num !== undefined && Number.isSafeInteger(num) && num > 0) {
      numToIndex.set(num, i);
    }
  }

  if (numToIndex.size > 0) {
    const bracketPattern = /(?:\[|［)(\d{1,3}(?:\s*[,，;；\-–—]\s*\d{1,3})*)(?:\]|］)/g;
    for (const line of bodyLines) {
      for (const match of line.text.matchAll(bracketPattern)) {
        const inner = match[1];
        for (const part of inner.split(/[,，;；]/)) {
          const range = part.trim().split(/[\-–—]/).map((s) => Number(s.trim()));
          if (range.length === 2 && Number.isInteger(range[0]) && Number.isInteger(range[1]) && range[1] >= range[0] && range[1] - range[0] <= 25) {
            for (let n = range[0]; n <= range[1]; n++) {
              const idx = numToIndex.get(n);
              if (idx !== undefined) counts.set(idx, (counts.get(idx) || 0) + 1);
            }
          } else if (range.length === 1 && Number.isInteger(range[0])) {
            const idx = numToIndex.get(range[0]);
            if (idx !== undefined) counts.set(idx, (counts.get(idx) || 0) + 1);
          }
        }
      }
    }
  }

  return counts;
}

/**
 * Navigates the active or associated Zotero PDF Reader to the page and coordinates
 * where a reference entry was extracted.
 */
export async function navigateToPdfReference(
  views: Views,
  parent: Zotero.Item | undefined,
  ref: ItemBaseInfo,
  win: Window = window
): Promise<boolean> {
  const page = Number(ref.page);
  if (!Number.isSafeInteger(page) || page < 1 || !parent) return false;

  let reader: any = views.utils.getReader(win);
  const attachment = await views.pdfAttachment(parent, reader);
  const targetAttachmentID = attachment?.id;

  if (!reader || (targetAttachmentID && Number(reader.itemID) !== targetAttachmentID)) {
    const allReaders: any[] = Array.isArray((Zotero as any).Reader?._readers) ? (Zotero as any).Reader._readers : [];
    reader = allReaders.find((r) => r && Number(r.itemID) === targetAttachmentID) || reader;
  }

  if (!reader && targetAttachmentID && typeof (Zotero as any).Reader?.open === "function") {
    try {
      reader = await (Zotero as any).Reader.open(targetAttachmentID, undefined, { openInWindow: false });
    } catch (error) {
      ztoolkit.log("Failed to open PDF reader for reference navigation", error);
    }
  }

  if (!reader) return false;

  try {
    if (reader.tabID && (win as any).Zotero_Tabs?.select) {
      (win as any).Zotero_Tabs.select(reader.tabID);
    }
    const pageIndex = page - 1;
    const pdfViewer =
      reader._internalReader?._primaryView?._iframeWindow?.PDFViewerApplication?.pdfViewer ||
      reader._iframeWindow?.PDFViewerApplication?.pdfViewer;

    if (pdfViewer && typeof pdfViewer.scrollPageIntoView === "function") {
      const destArray = Number.isFinite(Number(ref.y))
        ? [null, { name: "XYZ" }, Number.isFinite(Number(ref.x)) ? Number(ref.x) : null, Number(ref.y) + 24, null]
        : undefined;
      pdfViewer.scrollPageIntoView({ pageNumber: page, ...(destArray ? { destArray } : {}) });
      return true;
    }

    if (typeof reader.navigate === "function") {
      await reader.navigate({ pageIndex });
      return true;
    }
    if (typeof reader._internalReader?.navigate === "function") {
      await reader._internalReader.navigate({ pageIndex });
      return true;
    }
  } catch (error) {
    ztoolkit.log("PDF reference navigation failed", error);
  }
  return false;
}
