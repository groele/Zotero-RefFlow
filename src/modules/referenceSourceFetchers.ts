import {cacheEnabled, retentionMs} from "./cachePolicy";
import { getString } from "../utils/locale";
import { safeProviderAttempt } from "./referenceSourceDetails";
import { getSnapshotSignatures } from "./referenceAttachment";
import {
  type ReferenceResult,
  retrieveReferenceList,
  normalizeReferenceResult
} from "./referenceRetrieval";
import {
  preferCachedReferences,
  cacheReferenceResult,
  readCachedReferenceResult,
  readCachedReferences
} from "./referenceCache";
import type { ReferenceTaskContext } from "./referenceTasks";
import Views from "./views";

export interface SourceFetcherResult {
  references: ItemBaseInfo[];
  resultSource: string;
  sourceEvidence: any;
  savedAt?: number;
  signature?: string;
}

/**
 * Builds the cache signature for non-PDF retrieval modes.
 */
export async function buildRetrievalSignature(
  views: Views,
  item: Zotero.Item,
  source: string,
  reader: any
): Promise<string> {
  if (source === "Related" || source === "Citations") {
    return JSON.stringify(["neighborhood-v1", source, item.getField("DOI"), item.getField("title"), item.getField("date"), item.getCreators()]);
  }
  return JSON.stringify([
    "retrieval-v8",
    item.getField("DOI"),
    item.getField("url"),
    item.getField("title"),
    item.getField("date"),
    item.getCreators(),
    ["Auto", "API"].includes(source) ? await views.pdfCacheSignature(item, reader) : "",
    ["Auto", "Web"].includes(source) ? await getSnapshotSignatures(item) : []
  ]);
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
  showUnavailable: (result: ReferenceResult) => void,
  cacheOnly: boolean = false
): Promise<SourceFetcherResult | undefined> {
  const key = `References-${source}`;
  const cached = await views.storage.getAsync(item, key);
  if (!task.isCurrent()) return;
  const previous = !fromCurrentPage ? readCachedReferenceResult(cached, signature) : undefined;
  let result: ReferenceResult;
  if (local && previous) {
    result = previous;
  } else if (cacheOnly) {
    return undefined;
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
  return { references, resultSource, sourceEvidence, savedAt: local && previous ? cached.savedAt : undefined };
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
  showUnavailable: (result: ReferenceResult) => void,
  cacheOnly: boolean = false
): Promise<SourceFetcherResult | undefined> {
  const key = "References-PDF";
  const cached = await views.storage.getAsync(item, key);
  if (!task.isCurrent()) return;
  let partial = Boolean(cached?.snapshot?.partial);
  const empty = cached?.snapshot?.status === "empty";
  let references = local && cacheEnabled("PDF") && !fromCurrentPage && signature ? (readCachedReferences(cached, signature, retentionMs("pdf", partial || empty)) as any) : undefined;
  if (!task.isCurrent()) return undefined;

  let resultSource = "PDF";
  let sourceEvidence: any;

  if (references) {
    if (partial) resultSource += ` · ${getString("relatedbox-scan-limited")}`;
    sourceEvidence = { source: "PDF", count: references.length, partial, status: empty ? "empty" : partial ? "partial" : "success" };
    if (cacheOnly) return { references, resultSource, sourceEvidence };
  } else if (cacheOnly) {
    return undefined;
  } else {
    let attachment: Zotero.Item | undefined;
    let attachmentError: string | undefined;
    try {
      attachment = await views.pdfAttachment(item, reader);
    } catch (error) {
      if (fromCurrentPage || task.signal.aborted) throw error;
      attachmentError = safeProviderAttempt(String(error));
    }
    if (!task.isCurrent()) return undefined;
    let pdfUnavailable = false;
    let pdfAttempt: string | undefined;
    if (!attachment) {
      references = [];
      pdfUnavailable = true;
      pdfAttempt = attachmentError || "PDF: unavailable";
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
  showUnavailable: (result: ReferenceResult) => void,
  cacheOnly: boolean = false
): Promise<SourceFetcherResult | undefined> {
  const key = "References-API";
  const cached = await views.storage.getAsync(item, key);
  if (!task.isCurrent()) return;
  const previous = !fromCurrentPage ? readCachedReferenceResult(cached, signature) : undefined;
  if (!task.isCurrent()) return undefined;
  let result: ReferenceResult;
  if (local && previous) {
    result = previous;
  } else if (cacheOnly) {
    return undefined;
  } else {
    result = await retrieveReferenceList([
      { name: "Online", run: () => views.onlineReferences(item, task, label) },
      {
        name: "PDF fallback",
        run: async () => {
          const attachment = await views.pdfAttachment(item, reader);
          if (!task.isCurrent()) return;
          if (!attachment) {
            if (reader?.itemID) throw new Error("Selected PDF is unavailable");
            return "not-applicable";
          }
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
  return { references, resultSource, sourceEvidence, savedAt: local && previous ? cached.savedAt : undefined };
}

export async function readPaneCachedReferences(
  views: Views,
  item: Zotero.Item,
  primarySource: string,
  reader: any,
  task: ReferenceTaskContext
): Promise<SourceFetcherResult | undefined> {
  for (const cand of new Set([primarySource, "Auto", "API", "PDF", "Web"])) {
    if (!task.isCurrent()) return;
    if (cand === "PDF" && !cacheEnabled("PDF")) continue;
    const raw = await views.storage.getAsync(item, `References-${cand}`);
    if (!task.isCurrent()) return;
    if (!raw) continue;
    if (cand === "PDF") {
      const pdfSig = await views.pdfCacheSignature(item, reader);
      if (!pdfSig || !task.isCurrent()) continue;
      const partial = Boolean(raw?.snapshot?.partial);
      const empty = raw?.snapshot?.status === "empty";
      const refs = readCachedReferences(raw, pdfSig, retentionMs("pdf", partial || empty)) as ItemBaseInfo[] | undefined;
      if (refs?.length) {
        return {
          references: refs,
          resultSource: "PDF" + (partial ? ` · ${getString("relatedbox-scan-limited")}` : ""),
          sourceEvidence: { source: "PDF", count: refs.length, partial, status: partial ? "partial" : "success" }
        };
      }
    } else {
      const sig = await buildRetrievalSignature(views, item, cand, reader);
      if (!task.isCurrent()) continue;
      const res = readCachedReferenceResult(raw, sig);
      if (res && (res.references.length || (cand === primarySource && res.status === "empty"))) {
        return {
          signature: sig,
          savedAt: raw.savedAt,
          references: res.references,
          resultSource: views.referenceDescription(res),
          sourceEvidence: {
            source: res.source,
            count: res.references.length,
            expected: res.expected,
            partial: Boolean(res.partial),
            retained: res.retained,
            attempts: res.attempts,
            status: res.status,
            latestAttempt: res.latestAttempt
          }
        };
      }
    }
  }
  return undefined;
}
