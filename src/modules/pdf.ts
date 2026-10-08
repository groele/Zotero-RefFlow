import Utils from "./utils";
import { extractReferencesFromLines, ReferenceTextLine } from "./referenceExtractor";

/** Extract reference entries from the text layer exposed by Zotero 10's PDF.js reader. */
class PDF {
  public utils: Utils;

  constructor(utils?: Utils) {
    this.utils = utils || new Utils();
  }

  async getReferences(reader: _ZoteroTypes.ReaderInstance, fromCurrentPage: boolean): Promise<ItemInfo[]> {
    const lines = await this.readReferenceLines(reader, fromCurrentPage);
    const extracted = extractReferencesFromLines(lines);
    const references = extracted.map((ref, index) => {
      const parsedInfo = this.utils.refText2Info(ref.text);
      return {
        text: ref.text,
        ...parsedInfo,
        number: ref.number || index + 1,
        sources: ["PDF"],
        confidence: parsedInfo.identifiers?.DOI ? 0.9 : 0.6,
        y: ref.y
      } as ItemInfo;
    });
    const progress = new ztoolkit.ProgressWindow(references.length ? "[Done] PDF" : "[No references] PDF", { closeOtherProgressWindows: true });
    progress.createLine({
      text: references.length ? `${references.length} references extracted` : "No reference section found in the scanned PDF pages",
      type: references.length ? "success" : "fail"
    }).show();
    ztoolkit.log("PDF reference extraction", { scannedLines: lines.length, count: references.length });
    return references;
  }

  /**
   * Read the PDF.js text layer from the active Zotero reader. Bibliographies usually
   * appear at the end, so scanning runs backward and stops as soon as a heading is found.
   */
  private async readReferenceLines(
    reader: _ZoteroTypes.ReaderInstance,
    fromCurrentPage: boolean
  ): Promise<ReferenceTextLine[]> {
    const deadline = Date.now() + 45000;
    let frame: any;
    for (let attempt = 0; attempt < 50 && Date.now() < deadline; attempt++) {
      frame = (reader as any)?._iframeWindow;
      if (frame) break;
      await Zotero.Promise.delay(100);
    }
    const application = frame?.wrappedJSObject?.PDFViewerApplication || frame?.PDFViewerApplication;
    if (!application) throw new Error("Zotero PDF reader is not ready");

    if (application.initializedPromise) {
      let timer: any;
      try {
        await Promise.race([
          application.initializedPromise,
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("PDF reader initialization timed out")), 10000); })
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    const pdfDocument = application.pdfDocument;
    const pageCount = Number(pdfDocument?.numPages || application.pagesCount || 0);
    if (!pdfDocument || !Number.isFinite(pageCount) || pageCount < 1) {
      throw new Error("PDF text document is unavailable");
    }

    const activePage = Math.min(pageCount, Math.max(1, Number(application.page) || pageCount));
    const endPage = fromCurrentPage ? activePage : pageCount;
    const firstPage = Math.max(1, endPage - 59);
    const result: ReferenceTextLine[] = [];
    for (let pageNumber = endPage; pageNumber >= firstPage; pageNumber--) {
      if (Date.now() > deadline) throw new Error("PDF text extraction timed out");
      // Prefer PDF.js's viewer page-view API. Its `pdfPage` keeps the PDF.js methods
      // visible in Zotero's cross-compartment reader; getPage() alone is Xray-wrapped.
      const pageView = application.pdfViewer?.getPageView?.(pageNumber - 1);
      const page = pageView?.pdfPage || await pdfDocument.getPage(pageNumber);
      const textPage = typeof page?.getTextContent === "function"
        ? page
        : page?.wrappedJSObject || (globalThis as any).Components?.utils?.waiveXrays?.(page);
      if (typeof textPage?.getTextContent !== "function") {
        throw new Error(`PDF.js text layer is unavailable on page ${pageNumber}`);
      }
      const content = await textPage.getTextContent({ includeMarkedContent: false });
      const items = (content?.items || []).filter((item: any) => typeof item?.str === "string" && item.str.trim());
      const pageLines = this.textItemsToLines(items, pageNumber);
      result.unshift(...pageLines);
      if (pageLines.some(line => /^(?:references?|bibliography|works\s+cited|参考文献|引用文献)\s*[:：.]?$/i.test(line.text.trim()))) {
        break;
      }
    }
    return result;
  }

  /** Reconstruct visual text lines in O(n log n) time; wide column gaps start a new line. */
  private textItemsToLines(items: any[], page: number): ReferenceTextLine[] {
    type Line = { text: string; x: number; y: number; height: number; right: number };
    const lines: Line[] = [];
    const ordered = items.map(item => ({
      item,
      x: Number(item.transform?.[4]),
      y: Number(item.transform?.[5]),
      height: Math.max(1, Number(item.height) || Math.hypot(Number(item.transform?.[2]) || 0, Number(item.transform?.[3]) || 0)),
      width: Math.abs(Number(item.width) || 0)
    })).filter(entry => Number.isFinite(entry.x) && Number.isFinite(entry.y))
      .sort((a, b) => b.y - a.y || a.x - b.x);

    const buckets = new Map<number, Line[]>();
    for (const entry of ordered) {
      const { item, x, y, height, width } = entry;
      const bucket = Math.round(y / 4);
      const nearby = [bucket - 1, bucket, bucket + 1].flatMap(key => buckets.get(key) || []);
      let line = nearby.find(candidate =>
        Math.abs(candidate.y - y) <= Math.max(1.5, Math.min(candidate.height, height) * 0.45) &&
        x - candidate.right <= Math.max(35, height * 3)
      );
      if (!line) {
        line = { text: "", x, y, height, right: x };
        lines.push(line);
        const group = buckets.get(bucket) || [];
        group.push(line);
        buckets.set(bucket, group);
      }
      const piece = String(item.str).trim();
      if (piece) line.text = line.text ? `${line.text} ${piece}` : piece;
      line.height = Math.max(line.height, height);
      line.right = Math.max(line.right, x + width);
    }

    return lines
      .filter(line => line.text.trim())
      .sort((a, b) => b.y - a.y || a.x - b.x)
      .map(line => ({ text: line.text.replace(/\s+/g, " ").trim(), page, y: line.y }));
  }
}

export default PDF;
