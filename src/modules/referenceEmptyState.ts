import { cacheEnabled, retentionMs } from "./cachePolicy";
import { buildRetrievalSignature } from "./referenceSourceFetchers";
import type Views from "./views";

interface EmptyState {
  itemID: number;
  type: string;
  source: string;
  signature: string;
  savedAt: number;
  provider: string;
}

export const emptyStates = new WeakMap<Element, EmptyState>();

export async function stillEmpty(views: Views, pane: Element, item: Zotero.Item): Promise<boolean> {
  const state = emptyStates.get(pane);
  if (!state || state.itemID !== item.id || !cacheEnabled(state.provider)
    || Date.now() - state.savedAt >= retentionMs("reference", true)
    || state.type !== (pane.getAttribute("data-refflow-type") || "References")
    || state.source !== pane.getAttribute("source")) return false;
  const reader = views.utils.getReader(pane.ownerDocument.defaultView!);
  const signature = await buildRetrievalSignature(views, item,
    state.type === "References" ? (state.source === "PDF" ? "Auto" : state.source) : state.type, reader);
  return emptyStates.get(pane) === state && state.signature === signature;
}
