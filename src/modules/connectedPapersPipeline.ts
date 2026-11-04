import { resolveGraphOrigins, type GraphOriginResolution } from "./graphOriginResolution";

export type ConnectedGraphResult = {
  status: "success" | "partial" | "origins-unavailable" | "graph-unavailable" | "cancelled";
  graph?: Graph;
  origins: GraphOriginResolution;
  source: "Connected Papers";
};

type PipelineDependencies = {
  resolvePaperID: (item: Zotero.Item, signal?: AbortSignal) => Promise<string | undefined>;
  fetchGraph: (originKey: string, signal?: AbortSignal) => Promise<Graph | undefined>;
  findLocalItem: (paper: any, libraryID: number) => Promise<Zotero.Item | undefined>;
  onProgress?: (complete: number, total: number) => void;
};

/** Resolve origins, fetch one graph, then attach local-item matches without mixing provider evidence. */
export async function buildConnectedPapersPipeline(
  items: Zotero.Item[],
  dependencies: PipelineDependencies,
  signal?: AbortSignal,
): Promise<ConnectedGraphResult> {
  const origins = await resolveGraphOrigins(items, dependencies.resolvePaperID, signal);
  if (origins.cancelled || signal?.aborted) return { status: "cancelled", origins, source: "Connected Papers" };
  if (!origins.ids.length) return { status: "origins-unavailable", origins, source: "Connected Papers" };

  const graph = await dependencies.fetchGraph(origins.ids.join("+"), signal);
  if (signal?.aborted) return { status: "cancelled", origins, source: "Connected Papers" };
  if (!graph?.nodes) return { status: "graph-unavailable", origins, source: "Connected Papers" };

  const libraries = [...new Set(items.map(item => item.libraryID))];
  const nodes = Object.values(graph.nodes);
  for (let index = 0; index < nodes.length; index++) {
    if (signal?.aborted) return { status: "cancelled", origins, source: "Connected Papers" };
    const paper = nodes[index];
    for (const libraryID of libraries) {
      try {
        const localItem = await dependencies.findLocalItem(paper, libraryID);
        if (signal?.aborted) return { status: "cancelled", origins, source: "Connected Papers" };
        if (localItem) {
          (paper as any)._itemID = localItem.id;
          break;
        }
      } catch {
        // A library lookup failure must not discard provider graph evidence or stop other libraries.
      }
    }
    dependencies.onProgress?.(index + 1, nodes.length);
  }

  return {
    status: origins.unresolvedItemIDs.length ? "partial" : "success",
    graph,
    origins,
    source: "Connected Papers",
  };
}
