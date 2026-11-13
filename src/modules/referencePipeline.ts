import {cacheEnabled, markFresh} from "./cachePolicy";
import { config } from "../../package.json";
import { getString } from "../utils/locale";
import CitationVerifier from "./verifier";
import { safeProviderAttempt, ReferenceSourceEvidence } from "./referenceSourceDetails";
import { referenceData } from "./referenceData";
import { ReferenceTaskContext } from "./referenceTasks";
import {
  ReferenceResult,
  ReferenceProvider,
  retrieveReferenceList
} from "./referenceRetrieval";
import { renderReferenceSourceDetails } from "./referenceSourceDetails";
import { getSnapshotSignatures, readerMatchesItem } from "./referenceAttachment";
import { fetchNeighborhoodReferences } from "./referenceNeighborhood";
import {
  fetchAutoOrWebReferences,
  fetchPdfReferences,
  fetchApiReferences
} from "./referenceSourceFetchers";
import { dispatchReferenceRefresh } from "./referenceRefreshDispatcher";
import Views from "./views";

export function getPanelItem(views: Views, panel: Element): Zotero.Item | undefined {
  const id = Number(panel.getAttribute("data-refflow-item-id"));
  const item = (id ? Zotero.Items.get(id) : views.utils.getItem(panel.ownerDocument.defaultView!)) || undefined;
  return item?.isAttachment() ? item.parentItem : item;
}

export function mayPersist(result: ReferenceResult): boolean {
  return cacheEnabled(result.source);
}

export function referenceDescription(result: ReferenceResult): string {
  const attempt = result.latestAttempt;
  return (
    result.source +
    (result.retained ? ` · ${getString("cards-kept-results")}` : "") +
    (attempt ? ` · ${getString("cards-latest-attempt")} ${attempt.count}${attempt.expected ? "/" + attempt.expected : attempt.partial ? "+" : ""}` : "") +
    (result.partial ? ` (${result.references.length}${result.expected ? "/" + result.expected : "+"} · ${getString("cards-partial")})` : "")
  );
}

export async function onlineReferences(
  views: Views,
  item: Zotero.Item,
  task: ReferenceTaskContext,
  label: HTMLElement
): Promise<ReferenceResult | undefined> {
  const api = views.utils.API;
  const url = String(item.getField("url") || "");
  const title = String(item.getField("title") || "");
  let doi = CitationVerifier.normalizeDOI(String(item.getField("DOI") || "")) || CitationVerifier.normalizeDOI(url) || "";
  if (!doi) {
    let fileName = views.utils.parseCNKIURL(url)?.fileName;
    if (fileName || views.utils.isChinese(title)) {
      try {
        if (!fileName) {
          const matched = await api.getTitleInfoByCNKI(title, task.signal);
          fileName = views.utils.parseCNKIURL(matched?.identifiers?.CNKI || "")?.fileName;
        }
        if (!task.isCurrent()) return;
        if (fileName) {
          const info = await api.getCNKIFileInfo(fileName, 0, task.signal);
          if (info?.references?.length) return { references: info.references, source: "CNKI", partial: info.referencePartial };
        }
      } catch (error: any) {
        if (task.signal.aborted || error?.name === "AbortError") throw error;
        ztoolkit.log("CNKI unavailable; continuing DOI resolution", safeProviderAttempt(String(error?.message || error)));
      }
    }
    if (!task.isCurrent()) return;
    label.textContent = getString("cards-resolving-doi");
    const creator = item.getCreators()[0] as any;
    doi = (await api.resolveWork(title, creator?.name || creator?.lastName, String(item.getField("date")), task.signal))?.doi || "";
  }
  const extra = typeof item.getField === "function" ? String(item.getField("extra") || "") : "";
  const arxivId = views.utils.matchArXiv?.(url) || views.utils.matchArXiv?.(extra) || views.utils.matchArXiv?.(doi) || (doi.match(/^10\.48550\/arXiv\.(.+)$/i)?.[1]);
  if (!doi || !task.isCurrent()) {
    if (arxivId && task.isCurrent() && typeof api.semanticScholar?.neighborhood === "function") {
      const s2 = await api.semanticScholar.neighborhood(`ARXIV:${arxivId}`, "References", task.signal);
      if (s2?.references?.length) return s2;
    }
    return;
  }
  const result = await api.getReferenceList(doi, url, title, task.signal);
  if ((!result.references.length || result.partial) && arxivId && task.isCurrent() && typeof api.semanticScholar?.neighborhood === "function") {
    const s2 = await api.semanticScholar.neighborhood(`ARXIV:${arxivId}`, "References", task.signal);
    if (s2?.references?.length && s2.references.length > result.references.length) return s2;
  }
  return result;
}

export async function smartReferences(
  views: Views,
  item: Zotero.Item,
  reader: any,
  task: ReferenceTaskContext,
  includePDF: boolean,
  fromCurrentPage: boolean,
  label: HTMLElement,
  webFirst = false
): Promise<ReferenceResult> {
  const api = views.utils.API;
  const title = String(item.getField("title"));
  const url = String(item.getField("url"));
  let doi = String(item.getField("DOI") || "");
  const resolveDOI = async () => {
    if (!views.utils.isDOI(doi)) doi = CitationVerifier.normalizeDOI(url) || "";
    if (!doi && task.isCurrent()) {
      doi = (await api.resolveWork(title, (item.getCreators()[0] as any)?.lastName, String(item.getField("date")), task.signal))?.doi || "";
    }
    return doi;
  };

  const providers: ReferenceProvider[] = [];
  if (includePDF) {
    providers.push({
      name: "PDF",
      run: async () => {
        const attachment = await views.pdfAttachment(item, reader);
        if (!attachment || !task.isCurrent()) return;
        const references = await views.utils.PDF.getReferences(attachment, fromCurrentPage, {
          signal: task.signal,
          pageIndex: task.pageIndex,
          notify: false,
          onProgress: (pages) => {
            if (task.isCurrent()) label.textContent = `${getString("relatedbox-loading")} PDF · ${pages} ${getString("relatedbox-pages-label")}`;
          }
        });
        const diagnostics = views.utils.PDF.getDiagnostics(attachment);
        const suspiciouslyFew = !fromCurrentPage && references.length > 0 && (references.length <= 7 || (!diagnostics?.headingFound && references.length < 10));
        return { references, source: "PDF", partial: Boolean(diagnostics?.scanLimited || suspiciouslyFew) };
      }
    });
  }

  providers.push({
    name: "Snapshot",
    run: async () => {
      for (const id of item.getAttachments().slice(0, 20)) {
        if (!task.isCurrent()) return;
        const attachment = Zotero.Items.get(id);
        if (!attachment || attachment.attachmentContentType !== "text/html" || attachment.deleted) continue;
        const path = await attachment.getFilePathAsync();
        if (!path) continue;
        const file = Zotero.File.pathToFile(path);
        if (!file.exists() || file.fileSize > 8 * 1024 * 1024) continue;
        const html = await Zotero.File.getContentsAsync(path);
        if (typeof html !== "string") continue;
        const references = api.publisherReferences.parseHTML(html, String(attachment.getField("url") || url), doi, title);
        if (references.length) return { references, source: references[0].sources?.[0] + " snapshot" };
      }
      return undefined;
    }
  });

  if (webFirst) {
    providers.push({
      name: "Publisher / JATS",
      run: async () => {
        if (!await resolveDOI() || !task.isCurrent()) return;
        const references = await api.publisherReferences.getReferences(doi, url, title, task.signal);
        return { references, source: references[0]?.sources?.[0] || "Publisher" };
      }
    });
  }

  providers.push({ name: "Online", run: () => views.onlineReferences(item, task, label) });
  return retrieveReferenceList(providers, task.signal, (source) => {
    if (task.isCurrent()) label.textContent = `${getString("relatedbox-loading")} ${source}`;
  });
}

export async function sortReferences(panel: HTMLElement): Promise<void> {
  const refs: ItemBaseInfo[] = (panel as any).references || [];
  const displayed = [...refs];
  const sort = Zotero.Prefs.get(`${config.addonRef}.sortBy`);
  if (sort === "Recency") displayed.sort((a, b) => Number(b.year || 0) - Number(a.year || 0));
  if (sort === "Cited Count") displayed.sort((a, b) => Number(b.citationCount || 0) - Number(a.citationCount || 0));
  const identity = panel.getAttribute("data-refflow-item-id");
  await (panel as any)._cards?.render(displayed, () => panel.isConnected && panel.getAttribute("data-refflow-item-id") === identity && (panel as any).references === refs);
  (panel as any)._cards?.updateStatus();
}

export async function performReferences(
  views: Views,
  panel: XUL.TabPanel,
  local: boolean,
  fromCurrentPage: boolean,
  item: Zotero.Item,
  readerOverride: _ZoteroTypes.ReaderInstance | undefined,
  task: ReferenceTaskContext
) {
  const label = panel.querySelector("label#reference-num") as HTMLLabelElement;
  const literatureType = panel.getAttribute("data-refflow-type") || "References";
  const initialSource = panel.getAttribute("source") || "PDF";
  label.textContent = `${getString("relatedbox-loading")} [${initialSource}]`;
  const details = panel.querySelector("#refflow-source-details") as HTMLDetailsElement | undefined;
  if (details && Zotero.Prefs.get(`${config.addonRef}.showSourceDetails`) !== false) details.hidden = false;
  const source = fromCurrentPage && literatureType === "References" ? "PDF" : initialSource;
  let reader = readerOverride || views.utils.getReader(panel.ownerDocument.defaultView!);
  if (!readerMatchesItem(reader, item)) reader = undefined as any;
  const signature = source === "PDF"
    ? await views.pdfCacheSignature(item, reader)
    : JSON.stringify([
        "retrieval-v8",
        item.getField("DOI"),
        item.getField("url"),
        item.getField("title"),
        item.getField("date"),
        item.getCreators(),
        ["Auto", "API"].includes(source) ? await views.pdfCacheSignature(item, reader) : "",
        ["Auto", "Web"].includes(source) ? await getSnapshotSignatures(item) : []
      ]);
  if (!task.isCurrent()) return;

  if (panel.getAttribute("data-refflow-result-type") && panel.getAttribute("data-refflow-result-type") !== literatureType) {
    (panel as any)._cards?.clear();
    (panel as any).references = [];
  }

  let references: ItemBaseInfo[] = [];
  if (!local || !cacheEnabled()) markFresh(task.signal);

  let resultSource = source;
  let sourceEvidence: ReferenceSourceEvidence | undefined;
  const setSourceEvidence = (evidence: ReferenceSourceEvidence) => {
    sourceEvidence = evidence;
    const det = panel.querySelector("#refflow-source-details") as HTMLDetailsElement | undefined;
    if (det) {
      renderReferenceSourceDetails(det, evidence, (key, args) => args ? getString(key, { args }) : getString(key));
      det.hidden = Zotero.Prefs.get(`${config.addonRef}.showSourceDetails`) === false;
    }
  };

  const showUnavailable = (result: ReferenceResult) => {
    const previous = panel.querySelector("#refflow-source-details") as HTMLDetailsElement | undefined;
    const displayed = (panel as any).references as ItemBaseInfo[] | undefined;
    const hasDisplayed = Boolean(displayed?.length);
    const count = hasDisplayed ? displayed!.length : result.references.length;
    const expected = hasDisplayed && previous?.dataset.expected ? Number(previous.dataset.expected) : result.expected;
    setSourceEvidence({
      source: hasDisplayed ? (panel.getAttribute("data-refflow-result-source") || result.source) : result.source,
      count,
      expected: Number.isSafeInteger(expected) ? expected : undefined,
      partial: hasDisplayed ? previous?.dataset.partial === "true" : Boolean(result.partial),
      retained: hasDisplayed,
      attempts: result.attempts,
      status: hasDisplayed ? (previous?.dataset.status === "partial" ? "partial" : "success") : "unavailable",
      latestAttempt: hasDisplayed ? { source: result.source, count: 0, partial: true } : undefined,
    });
  };

  let fetched: { references: ItemBaseInfo[]; resultSource: string; sourceEvidence: any } | undefined;
  if (literatureType !== "References") {
    fetched = await fetchNeighborhoodReferences(views, item, literatureType, signature, local, task, label);
  } else if (source === "Auto" || source === "Web") {
    fetched = await fetchAutoOrWebReferences(views, item, source, reader, task, local, fromCurrentPage, signature, label, showUnavailable);
  } else if (source === "PDF") {
    fetched = await fetchPdfReferences(views, item, reader, task, local, fromCurrentPage, signature, label, showUnavailable);
  } else {
    fetched = await fetchApiReferences(views, item, reader, task, local, fromCurrentPage, signature, label, showUnavailable);
  }

  if (!task.isCurrent() || !fetched) return;
  references = fetched.references;
  resultSource = fetched.resultSource;
  sourceEvidence = fetched.sourceEvidence;

  if (!references) references = [];
  references = references.map(referenceData);
  const keepPrevious = !references.length && Boolean((panel as any).references?.length) &&
    (sourceEvidence?.status === "unavailable" || (sourceEvidence?.status !== "empty" && Boolean(sourceEvidence?.partial)));
  if (keepPrevious) {
    label.textContent = `${(panel as any).references.length} · ${getString("cards-refresh-empty-kept")}`;
    return;
  }
  const referenceNum = references.length;
  if (sourceEvidence) setSourceEvidence(sourceEvidence);
  panel.setAttribute("data-refflow-result-type", literatureType);
  (panel as any).references = references;

  const currentSource = resultSource;
  panel.setAttribute("data-refflow-result-source", resultSource);
  const refreshBtn = panel.querySelector("#refresh-button") as HTMLButtonElement;
  if (refreshBtn) {
    refreshBtn.title = getString("relatedbox-source-tooltip", { args: { source: currentSource } });
  }

  if (referenceNum === 0) {
    (panel as any)._cards?.clear();
    (panel as any)._setL10nArgs?.(JSON.stringify({ count: 0 }));
    label.textContent = `${getString(["Auto", "Web", "PDF"].includes(source) ? "cards-auto-empty" : "relatedbox-empty")} [${currentSource}]`;
    return;
  }
  await views.sortReferences(panel as any);
  if (!task.isCurrent()) return;
  (panel as any)._setL10nArgs?.(JSON.stringify({ count: referenceNum }));
  label.innerText = `${referenceNum} ${getString("relatedbox-number-label")} [${currentSource}]`;
  (panel as any)._cards?.updateStatus();
}

export function refreshReferences(
  views: Views,
  panel: XUL.TabPanel,
  local: boolean = true,
  fromCurrentPage: boolean = false,
  toggleSource: boolean = false,
  itemOverride?: Zotero.Item,
  readerOverride?: _ZoteroTypes.ReaderInstance
) {
  return dispatchReferenceRefresh(views, panel, local, fromCurrentPage, toggleSource, itemOverride, readerOverride);
}
