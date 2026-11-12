import {cacheEnabled, retentionMs} from "./cachePolicy";
import { getString } from "../utils/locale";
import { safeProviderAttempt } from "./referenceSourceDetails";
import {
  ReferenceResult,
  retrieveReferenceList,
  normalizeReferenceResult
} from "./referenceRetrieval";
import {
  preferCachedReferences,
  cacheReferenceResult,
  readCachedReferenceResult,
  readCachedReferences
} from "./referenceCache";
import { ReferenceTaskContext } from "./referenceTasks";
import Views from "./views";

export interface SourceFetcherResult {
  references: ItemBaseInfo[];
  resultSource: string;
  sourceEvidence: any;
}

export async function fetchAutoOrWebReferences(
  views: Views,
  item: Zotero.Item,
  source: string,
  reader: any,
  task: ReferenceTaskContext,
  local: boolean,
  fromCurrentPage: boolean,
  signature: string,
  label: HTMLElement,
  showUnavailable: (result: ReferenceResult) => void
): Promise<SourceFetcherResult | undefined> {
  const key = `References-${source}`;
  const cached = await views.storage.getAsync(item, key);
  const previous = !fromCurrentPage ? readCachedReferenceResult(cached, signature) : undefined;
  let result: ReferenceResult;
  if (local && previous) {
    result = previous;
  } else {
    result = await views.smartReferences(item, reader, task, source !== "Web", fromCurrentPage, label, source === "Web");
    if (!task.isCurrent()) return undefined;
    result = preferCachedReferences(result, previous, getString("cards-cached-offline"));
    if ((result.references.length || result.status === "empty") && !result.retained && !fromCurrentPage && views.mayPersist(result)) {
      await views.storage.set(item, key, cacheReferenceResult(result, signature));
    }
  }
  if (result.status === "unavailable" && !result.references.length) {
    showUnavailable(result);
    throw new Error(result.attempts?.join("; ") || "Reference providers unavailable");
  }
  const references = result.references;
  const resultSource = views.referenceDescription(result);
  const sourceEvidence = { source: result.source, count: result.references.length, expected: result.expected, partial: Boolean(result.partial), retained: result.retained, attempts: result.attempts, status: result.status, latestAttempt: result.latestAttempt };
  label.title = (result.attempts || []).map(safeProviderAttempt).join("\n");
  return { references, resultSource, sourceEvidence };
}

export async function fetchPdfReferences(
  views: Views,
  item: Zotero.Item,
  reader: any,
  task: ReferenceTaskContext,
  local: boolean,
  fromCurrentPage: boolean,
  signature: string,
  label: HTMLElement,
  showUnavailable: (result: ReferenceResult) => void
): Promise<SourceFetcherResult | undefined> {
  const key = "References-PDF";
  const cached = await views.storage.getAsync(item, key);
  let partial = Boolean(cached?.snapshot?.partial);
  const empty = cached?.snapshot?.status === "empty";
  let references = local && cacheEnabled("PDF") && !fromCurrentPage && signature ? (readCachedReferences(cached, signature, retentionMs("pdf", partial || empty)) as any) : undefined;
  if (!task.isCurrent()) return undefined;

  let resultSource = "PDF";
  let sourceEvidence: any;

  if (references) {
    if (partial) resultSource += ` · ${getString("relatedbox-scan-limited")}`;
    sourceEvidence = { source: "PDF", count: references.length, partial, status: empty ? "empty" : partial ? "partial" : "success" };
  } else {
    const attachment = await views.pdfAttachment(item, reader);
    if (!task.isCurrent()) return undefined;
    let pdfUnavailable = false;
    let pdfAttempt: string | undefined;
    if (!attachment) {
      references = [];
      pdfUnavailable = true;
      pdfAttempt = "PDF: unavailable";
    } else {
      try {
        references = await views.utils.PDF.getReferences(attachment, fromCurrentPage, {
          signal: task.signal,
          pageIndex: task.pageIndex,
          notify: false,
          onProgress: (scanned) => {
            if (task.isCurrent()) label.textContent = `${getString("relatedbox-loading")} PDF · ${scanned} ${getString("relatedbox-pages-label")}`;
          }
        });
      } catch (error: any) {
        if (error?.name === "AbortError" || fromCurrentPage) throw error;
        references = [];
        pdfUnavailable = true;
        const message = safeProviderAttempt(String(error?.message || error));
        pdfAttempt = `PDF: ${message}`;
        ztoolkit.log("PDF failed; trying structured sources", message);
      }
    }
    if (!task.isCurrent()) return undefined;
    const result = preferCachedReferences(
      normalizeReferenceResult({
        references,
        source: "PDF",
        partial: Boolean(attachment && views.utils.PDF.getDiagnostics(attachment)?.scanLimited),
        ...(pdfUnavailable ? { status: "unavailable" as const, attempts: pdfAttempt ? [pdfAttempt] : undefined } : {})
      }),
      fromCurrentPage ? undefined : readCachedReferenceResult(cached, signature),
      getString("cards-cached-offline")
    );
    references = result.references;
    partial = Boolean(result.partial);
    resultSource = views.referenceDescription(result);
    sourceEvidence = { source: result.source, count: result.references.length, expected: result.expected, partial: Boolean(result.partial), retained: result.retained, attempts: result.attempts, status: result.status, latestAttempt: result.latestAttempt };
    if ((references.length || result.status === "empty") && !result.retained && signature && !fromCurrentPage && views.mayPersist(result)) {
      await views.storage.set(item, key, cacheReferenceResult(result, signature));
    }
  }

  if (!references?.length && !fromCurrentPage) {
    const result = await views.smartReferences(item, undefined, task, false, false, label);
    if (!task.isCurrent()) return undefined;
    if (result.status === "unavailable" && !result.references.length) {
      showUnavailable(result);
      throw new Error(result.attempts?.join("; ") || "Reference providers unavailable");
    }
    references = result.references;
    resultSource = views.referenceDescription(result);
    sourceEvidence = { source: result.source, count: result.references.length, expected: result.expected, partial: Boolean(result.partial), retained: result.retained, attempts: result.attempts, status: result.status, latestAttempt: result.latestAttempt };
    label.title = (result.attempts || []).map(safeProviderAttempt).join("\n");
  }

  return { references, resultSource, sourceEvidence };
}

export async function fetchApiReferences(
  views: Views,
  item: Zotero.Item,
  reader: any,
  task: ReferenceTaskContext,
  local: boolean,
  fromCurrentPage: boolean,
  signature: string,
  label: HTMLElement,
  showUnavailable: (result: ReferenceResult) => void
): Promise<SourceFetcherResult | undefined> {
  const key = "References-API";
  const cached = await views.storage.getAsync(item, key);
  const previous = !fromCurrentPage ? readCachedReferenceResult(cached, signature) : undefined;
  if (!task.isCurrent()) return undefined;
  let result: ReferenceResult;
  if (local && previous) {
    result = previous;
  } else {
    result = await retrieveReferenceList([
      { name: "Online", run: () => views.onlineReferences(item, task, label) },
      {
        name: "PDF fallback",
        run: async () => {
          const attachment = await views.pdfAttachment(item, reader);
          if (!attachment || !task.isCurrent()) return;
          const refs = await views.utils.PDF.getReferences(attachment, fromCurrentPage, { signal: task.signal, pageIndex: task.pageIndex, notify: false });
          return { references: refs, source: "PDF fallback", partial: views.utils.PDF.getDiagnostics(attachment)?.scanLimited };
        }
      }
    ], task.signal, (src) => {
      if (task.isCurrent()) label.textContent = `${getString("relatedbox-loading")} ${src}`;
    });
    if (!task.isCurrent()) return undefined;
    result = preferCachedReferences(result, previous, getString("cards-cached-offline"));
    if ((result.references.length || result.status === "empty") && !result.retained && !fromCurrentPage && views.mayPersist(result)) {
      await views.storage.set(item, key, cacheReferenceResult(result, signature));
    }
  }
  if (result.status === "unavailable" && !result.references.length) {
    showUnavailable(result);
    throw new Error(result.attempts?.join("; ") || "Reference providers unavailable");
  }
  const references = result.references;
  const resultSource = views.referenceDescription(result);
  const sourceEvidence = { source: result.source, count: result.references.length, expected: result.expected, partial: Boolean(result.partial), retained: result.retained, attempts: result.attempts, status: result.status, latestAttempt: result.latestAttempt };
  label.title = (result.attempts || []).map(safeProviderAttempt).join("\n");
  return { references, resultSource, sourceEvidence };
}
