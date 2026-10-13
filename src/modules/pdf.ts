import Utils from "./utils";
import { extractReferencesFromLines, isBibliographyHeading, ReferenceTextLine } from "./referenceExtractor";
import { structuredPageToLines } from "./structuredPDF";

export interface PDFExtractionOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxPages?: number;
  notify?: boolean;
  onProgress?: (scannedPages: number, totalPages: number) => void;
  pageIndex?: number;
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

  async getReferences(reader: _ZoteroTypes.ReaderInstance | Zotero.Item, fromCurrentPage: boolean, options: PDFExtractionOptions = {}): Promise<ItemInfo[]> {
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

  /** Deadlines also cover native SDT generation and page reads that never settle. */
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
          timer=globalThis.setTimeout(()=>reject(this.error("TimeoutError","PDF text extraction timed out")),remaining);
          abort=()=>reject(this.error("AbortError","Reference extraction cancelled"));
          signal?.addEventListener("abort",abort,{once:true});
        })
      ]);
    } finally { globalThis.clearTimeout(timer);signal?.removeEventListener("abort",abort); }
  }

  private async readReferenceLines(reader: _ZoteroTypes.ReaderInstance | Zotero.Item, fromCurrentPage: boolean, options: PDFExtractionOptions, stats: PDFDiagnostics): Promise<ReferenceTextLine[]> {
    const deadline=Date.now()+Math.max(1,options.timeoutMs ?? 45000);
    const itemID=Number((reader as any).itemID || (reader as Zotero.Item).id);
    const attachment = "attachmentContentType" in reader ? reader as Zotero.Item : Zotero.Items.get(itemID);
    if(!attachment || attachment.deleted || attachment.attachmentContentType!=="application/pdf")throw this.error("AbortError","PDF attachment is unavailable");
    const sdt=(Zotero as any).SDT;
    if(typeof sdt?.getReader!=="function")throw new Error("Zotero structured document text API is required");
    if(options.signal?.aborted)throw this.error("AbortError","Reference extraction cancelled");
    const pack:any=await this.bounded(sdt.getReader(itemID,{isPriority:true}),deadline,options.signal);
    if(!pack || !/^1\./.test(pack.header?.schemaVersion || ""))throw new Error("Native structured PDF text is unavailable or has an unsupported schema");
    const catalog:any=await this.bounded(pack.getCatalog(),deadline,options.signal);
    const pageCount=Array.isArray(catalog?.pages)?catalog.pages.length:0;
    if(pageCount<1)throw new Error("PDF text document is unavailable");
    stats.totalPages=pageCount;
    const pageIndex=options.pageIndex ?? attachment.getAttachmentLastPageIndex();
    const activePage=Math.min(pageCount,Math.max(1,Number.isInteger(pageIndex)?Number(pageIndex)+1:1));
    const end=fromCurrentPage?activePage:pageCount;
    const first=Math.max(1,end-Math.max(1,Math.min(200,options.maxPages??60))+1);
    const pages: ReferenceTextLine[][]=[];
    let startFound=false;
    for (let pageNumber=end;pageNumber>=first;pageNumber--) {
      if (attachment.deleted) throw this.error("AbortError","PDF attachment was deleted");
      const blocks:any=await this.bounded(pack.getPageBlocks(pageNumber-1),deadline,options.signal);
      const lines=structuredPageToLines(blocks,pageNumber-1,catalog.pages[pageNumber-1].viewRect);
      pages.push(lines);stats.pagesRead++;
      options.onProgress?.(stats.pagesRead,pageCount);
      if (lines.some(line=>isBibliographyHeading(line.text))) {
        stats.headingFound=true;
        // A continued/methods list may begin at 51; keep scanning for the main list.
        const firstReference=extractReferencesFromLines(lines)[0];
        if(firstReference && (firstReference.number===undefined||firstReference.number===1)){startFound=true;break;}
      }
      await this.bounded(Zotero.Promise.delay(0),deadline,options.signal);
    }
    stats.scanLimited=!startFound && first>1;
    return pages.reverse().flat();
  }
}
