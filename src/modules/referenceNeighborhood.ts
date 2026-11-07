import {cacheEnabled, retentionMs} from "./cachePolicy";
import { getString } from "../utils/locale";
import { safeProviderAttempt, ReferenceSourceEvidence } from "./referenceSourceDetails";
import { normalizeReferenceResult } from "./referenceRetrieval";
import { preferCachedReferences, cacheReferences, readCachedReferences } from "./referenceCache";
import { ReferenceTaskContext } from "./referenceTasks";
import Views from "./views";

export interface NeighborhoodResult {
  references: ItemBaseInfo[];
  resultSource: string;
  sourceEvidence: ReferenceSourceEvidence;
}

/**
 * Fetches citation or related work neighborhood items using OpenAlex with Semantic Scholar fallback.
 */
export async function fetchNeighborhoodReferences(
  views: Views,
  item: Zotero.Item,
  literatureType: string,
  signature: string,
  local: boolean,
  task: ReferenceTaskContext,
  label: HTMLElement
): Promise<NeighborhoodResult | undefined> {
  const key = `References-API-${literatureType}`;
  const cached = await views.storage.getAsync(item, key);
  const previous = cacheEnabled("Online") ? readCachedReferences(cached, signature, retentionMs("neighborhood", Boolean(cached?.snapshot?.truncated))) : undefined;
  const describe = (src: string, total: number, truncated: boolean, count: number) =>
    `${src} ${literatureType}${truncated ? (Number.isFinite(total) && total > count ? ` (${count}/${total})` : ` (${count}+ · ${getString("cards-partial")})`) : ""}`;

  let references: ItemBaseInfo[] = [];
  let resultSource = "";
  let sourceEvidence: ReferenceSourceEvidence;

  if (local && previous) {
    references = previous;
    resultSource = describe(cached?.snapshot?.source || "OpenAlex", Number(cached?.snapshot?.total || references.length), Boolean(cached?.snapshot?.truncated), references.length);
    sourceEvidence = { source: cached?.snapshot?.source || "OpenAlex", count: references.length, expected: cached?.snapshot?.total, partial: Boolean(cached?.snapshot?.truncated) };
    return { references, resultSource, sourceEvidence };
  }

  let doi = String(item.getField("DOI") || "");
  if (!doi) {
    doi = (await views.utils.API.resolveWork(String(item.getField("title")), (item.getCreators()[0] as any)?.lastName, String(item.getField("date")), task.signal))?.doi || "";
  }
  if (!task.isCurrent()) return undefined;
  if (!doi) throw new Error(getString("cards-work-not-found"));

  let result: any;
  let provider = "OpenAlex";
  try {
    result = await views.utils.API.openAlex.getNeighborhood(doi, literatureType as any, task.signal);
  } catch (error) {
    if (!task.isCurrent()) return undefined;
    if (previous) {
      references = previous;
      resultSource = describe(cached?.snapshot?.source || provider, Number(cached?.snapshot?.total || references.length), Boolean(cached?.snapshot?.truncated), references.length) + ` · ${getString("cards-cached-offline")}`;
      label.title = safeProviderAttempt(String(error));
      sourceEvidence = { retained: true, latestAttempt: {source: provider, count: 0, partial: true}, source: cached?.snapshot?.source || provider, count: references.length, expected: cached?.snapshot?.total, partial: Boolean(cached?.snapshot?.truncated) };
      return { references, resultSource, sourceEvidence };
    } else if (literatureType === "Citations") {
      const fallback = await views.utils.API.semanticScholar.neighborhood(doi, "Citations", task.signal);
      if (!task.isCurrent()) return undefined;
      if (!fallback || fallback.status === "unavailable" || (!fallback.references.length && fallback.partial)) throw error;
      result = { references: fallback.references, total: fallback.partial ? undefined : fallback.references.length, truncated: Boolean(fallback.partial) };
      provider = "Semantic Scholar";
    } else {
      throw error;
    }
  }

  if (!task.isCurrent()) return undefined;
  if (result) {
    const candidate = normalizeReferenceResult({ references: result.references, source: provider, expected: result.total, partial: result.truncated });
    const prior = previous ? { references: previous, source: cached?.snapshot?.source || provider, expected: cached?.snapshot?.total, partial: cached?.snapshot?.truncated } : undefined;
    const selected = preferCachedReferences(candidate, prior, getString("cards-cached-offline"));
    references = selected.references;
    resultSource = describe(selected.source, selected.expected!, Boolean(selected.partial), references.length) + (selected.retained ? ` · ${getString("cards-kept-results")}` : "");
    sourceEvidence = { source: selected.source, count: selected.references.length, expected: selected.expected, partial: Boolean(selected.partial), retained: selected.retained, attempts: [`${provider}: ${result.references.length}${result.truncated ? " (partial)" : ""}`], status: selected.status };
    if (!selected.retained && views.mayPersist(selected)) {
      await views.storage.set(item, key, { ...cacheReferences(references, signature), snapshot: { source: provider, total: selected.expected, truncated: Boolean(selected.partial) } });
    }
    return { references, resultSource, sourceEvidence };
  }

  return undefined;
}
