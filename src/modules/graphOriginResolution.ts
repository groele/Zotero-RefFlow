export type GraphOrigin = { id: number };
export type GraphOriginResolution = {
  ids: string[];
  resolvedItemIDs: number[];
  unresolvedItemIDs: number[];
  cancelled: boolean;
};

/** Resolve every selected origin before constructing the Connected Papers request key. */
export async function resolveGraphOrigins<T extends GraphOrigin>(
  items: T[],
  resolve: (item: T, signal?: AbortSignal) => Promise<string | undefined>,
  signal?: AbortSignal,
): Promise<GraphOriginResolution> {
  if (signal?.aborted) return { ids: [], resolvedItemIDs: [], unresolvedItemIDs: [], cancelled: true };

  const results = await Promise.all(items.map(async item => {
    if (signal?.aborted) return { item, paperID: undefined };
    try {
      return { item, paperID: await resolve(item, signal) };
    } catch {
      return { item, paperID: undefined };
    }
  }));
  if (signal?.aborted) return { ids: [], resolvedItemIDs: [], unresolvedItemIDs: [], cancelled: true };

  const ids: string[] = [];
  const resolvedItemIDs: number[] = [];
  const unresolvedItemIDs: number[] = [];
  const seen = new Set<string>();
  for (const { item, paperID } of results) {
    const normalized = typeof paperID === "string" ? paperID.trim() : "";
    // Connected Papers joins origin IDs with '+'. Reject invalid values before URL construction.
    if (!normalized || normalized.includes("+") || normalized.includes("/")) {
      unresolvedItemIDs.push(item.id);
      continue;
    }
    resolvedItemIDs.push(item.id);
    if (!seen.has(normalized)) {
      ids.push(normalized);
      seen.add(normalized);
    }
  }
  return { ids, resolvedItemIDs, unresolvedItemIDs, cancelled: false };
}
