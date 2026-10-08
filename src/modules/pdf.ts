import Utils from "./utils";
import { extractReferencesFromLines, isBibliographyHeading, ReferenceTextLine } from "./referenceExtractor";
import { textItemsToLines } from "./pdfLayout";

export interface PDFExtractionOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxPages?: number;
  notify?: boolean;
  onProgress?: (scannedPages: number, totalPages: number) => void;
}

export interface PDFDiagnostics {
  pagesRead: number;
  totalPages: number;
  headingFound: boolean;
  scanLimited: boolean;
  elapsedMs: number;
}

export default class PDF {
  public utils: Utils;
  private diagnostics = new WeakMap<object, PDFDiagnostics>();

  constructor(utils?: Utils) { this.utils = utils || new Utils(); }
  getDiagnostics(reader: object): PDFDiagnostics | undefined { return this.diagnostics.get(reader); }

  async getReferences(reader: _ZoteroTypes.ReaderInstance, fromCurrentPage: boolean, options: PDFExtractionOptions = {}): Promise<ItemInfo[]> {
    const start = Date.now();
    const stats: PDFDiagnostics = { pagesRead: 0, totalPages: 0, headingFound: false, scanLimited: false, elapsedMs: 0 };
    try {
      const lines = await this.readReferenceLines(reader, fromCurrentPage, options, stats);
      const extracted = extractReferencesFromLines(lines);
      const references: ItemInfo[] = [];
      for (let index = 0; index < extracted.length; index++) {
        if (options.signal?.aborted) throw this.error("AbortError", "Reference extraction cancelled");
        const ref = extracted[index];
        const parsed = this.utils.refText2Info(ref.text);
        references.push({ text: ref.text, ...parsed, number: ref.number || index + 1, sources: ["PDF"],
          confidence: parsed.identifiers?.DOI ? 0.9 : 0.6, y: ref.y, x: ref.x } as ItemInfo);
        if (index % 25 === 24) await Zotero.Promise.delay(0);
      }
      if (options.notify !== false) {
        new ztoolkit.ProgressWindow(references.length ? "[Done] PDF" : "[No references] PDF")
          .createLine({ text: references.length ? `${references.length} references extracted` : "No reference section found in the PDF text layer", type: references.length ? "success" : "fail" }).show();
      }
      return references;
    } finally {
      stats.elapsedMs = Date.now()-start;
      this.diagnostics.set(reader,stats);
      ztoolkit.log("PDF extraction diagnostics",stats);
    }
  }

  private error(name: string, message: string): Error { const error=new Error(message);error.name=name;return error; }

  /** Deadlines also cover getPage/getTextContent promises that never settle. */
  private async bounded<T>(work: PromiseLike<T> | T, deadline: number, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw this.error("AbortError","Reference extraction cancelled");
    const remaining=deadline-Date.now();
    if (remaining<=0) throw this.error("TimeoutError","PDF text extraction timed out");
    let timer: any;
    let abort: () => void = () => {};
    try {
      return await Promise.race([
        Promise.resolve(work),
        new Promise<never>((_,reject)=>{
          timer=window.setTimeout(()=>reject(this.error("TimeoutError","PDF text extraction timed out")),remaining);
          abort=()=>reject(this.error("AbortError","Reference extraction cancelled"));
          signal?.addEventListener("abort",abort,{once:true});
        })
      ]);
    } finally { window.clearTimeout(timer);signal?.removeEventListener("abort",abort); }
  }

  private async readReferenceLines(reader: _ZoteroTypes.ReaderInstance, fromCurrentPage: boolean, options: PDFExtractionOptions, stats: PDFDiagnostics): Promise<ReferenceTextLine[]> {
    const deadline=Date.now()+Math.max(1,options.timeoutMs ?? 45000);
    const readyDeadline=Math.min(deadline,Date.now()+5000);
    let application: any;
    while (!application) {
      if ((reader as any)?._destroyed) throw this.error("AbortError","PDF reader was closed");
      const frame=(reader as any)?._iframeWindow;
      application=frame?.wrappedJSObject?.PDFViewerApplication || frame?.PDFViewerApplication;
      if (!application) await this.bounded(Zotero.Promise.delay(100),readyDeadline,options.signal);
    }
    if (application.initializedPromise) await this.bounded(application.initializedPromise,Math.min(deadline,Date.now()+10000),options.signal);
    // PDFViewerApplication initialization can finish before its loading task.
    // Background opening exercises this race more often than an already visible reader.
    const loadDeadline=Math.min(deadline,Date.now()+10000);
    while(!application.pdfDocument) {
      if((reader as any)._destroyed)throw this.error("AbortError","PDF reader was closed");
      await this.bounded(Zotero.Promise.delay(100),loadDeadline,options.signal);
    }
    const document=application.pdfDocument;
    const pageCount=Number(document?.numPages || application.pagesCount || 0);
    if (!document || !Number.isFinite(pageCount) || pageCount<1) throw new Error("PDF text document is unavailable");
    stats.totalPages=pageCount;
    const activePage=Math.min(pageCount,Math.max(1,Number(application.page)||pageCount));
    const end=fromCurrentPage?activePage:pageCount;
    const first=Math.max(1,end-Math.max(1,Math.min(200,options.maxPages??60))+1);
    const pages: ReferenceTextLine[][]=[];
    for (let pageNumber=end;pageNumber>=first;pageNumber--) {
      if ((reader as any)._destroyed) throw this.error("AbortError","PDF reader was closed");
      const pageView=application.pdfViewer?.getPageView?.(pageNumber-1);
      const page=pageView?.pdfPage || await this.bounded(document.getPage(pageNumber),deadline,options.signal);
      const textPage=typeof page?.getTextContent==="function"?page:page?.wrappedJSObject || (globalThis as any).Components?.utils?.waiveXrays?.(page);
      if (typeof textPage?.getTextContent!=="function") throw new Error(`PDF text layer is unavailable on page ${pageNumber}`);
      const content: any=await this.bounded(textPage.getTextContent({includeMarkedContent:false}),deadline,options.signal);
      const width=Number(page.view?.[2])-Number(page.view?.[0]) || pageView?.viewport?.width || 612;
      const lines=textItemsToLines(content?.items||[],pageNumber,width);
      pages.push(lines);stats.pagesRead++;
      options.onProgress?.(stats.pagesRead,pageCount);
      if (lines.some(line=>isBibliographyHeading(line.text))) {stats.headingFound=true;break;}
      await this.bounded(Zotero.Promise.delay(0),deadline,options.signal);
    }
    stats.scanLimited=!stats.headingFound && first>1;
    return pages.reverse().flat();
  }
}
