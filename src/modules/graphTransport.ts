import Requests from "./requests";

/** Poll the official API using Zotero HTTP, with one cancellable total budget. */
export async function pollGraph(id: string, token: string, onProgress: (response: any) => void,
  signal?: AbortSignal, budgetMs = 60000, pollMs = 1000): Promise<any> {
  const controller = new AbortController();
  const requests = new Requests({ timeoutMs: 10000, budgetMs: 15000, cacheTTL: 0, maxConcurrent: 1 });
  let timedOut = false;
  const stop = () => controller.abort();
  signal?.addEventListener("abort", stop, { once: true });
  if (signal?.aborted) stop();
  const deadlineTimer = globalThis.setTimeout(() => { timedOut = true; stop(); }, budgetMs);
  const cancelled = () => {
    if (!controller.signal.aborted) return;
    const error = new Error(timedOut ? "Graph request timed out" : "Graph request cancelled");
    error.name = timedOut ? "TimeoutError" : "AbortError";
    throw error;
  };
  try {
    while (true) {
      cancelled();
      // A pending status must be re-fetched even if it arrives in the same ms.
      requests.clearCache();
      const response = await requests.get(`https://rest.prod.connectedpapers.com/papers-api/graph/1/${encodeURIComponent(id)}`,
        "json", { "X-Api-Key": token }, controller.signal);
      cancelled();
      if (!response || typeof response.status !== "string") throw new Error("Graph service returned no usable response");
      onProgress(response);
      if (["FRESH_GRAPH", "OLD_GRAPH"].includes(response.status)) {
        if (!response.graph_json?.nodes) throw new Error("Graph service returned invalid graph data");
        return response;
      }
      if (!["QUEUED", "IN_PROGRESS", "OVERLOADED"].includes(response.status)) return response;
      await new Promise<void>(resolve => {
        const finish = () => { globalThis.clearTimeout(timer); controller.signal.removeEventListener("abort", finish); resolve(); };
        const timer = globalThis.setTimeout(finish, response.status === "OVERLOADED" ? Math.max(pollMs, 5000) : pollMs);
        controller.signal.addEventListener("abort", finish, { once: true });
        if (controller.signal.aborted) finish();
      });
    }
  } finally {
    globalThis.clearTimeout(deadlineTimer);
    signal?.removeEventListener("abort", stop);
    controller.abort();
    requests.dispose();
  }
}
