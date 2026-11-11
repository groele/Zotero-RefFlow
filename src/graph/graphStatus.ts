export type GraphStatusOptions = {
  source?: string;
  partialOrigins?: number;
  retrievedAt?: string;
  language?: string;
  formatTime?: (timestamp: string) => string;
};

export function formatGraphStatus(papers: number, relationships: number, options: GraphStatusOptions = {}): string {
  const lang = String(options.language || "").toLowerCase();
  const chinese = lang.startsWith("zh");
  const italian = lang.startsWith("it");
  const source = options.source || "Connected Papers";
  const paperLabel = chinese ? "篇文献" : italian ? "articoli" : "papers";
  const linkLabel = chinese ? "条相似关系" : italian ? "collegamenti di somiglianza" : "similarity links";
  const summary = `${papers} ${paperLabel} · ${relationships} ${linkLabel} · ${source}`;
  const partial = options.partialOrigins
    ? ` · ${chinese ? "未解析起点" : italian ? "origini non risolte" : "unresolved origins"} ${options.partialOrigins}`
    : "";
  const time = options.retrievedAt
    ? ` · ${(options.formatTime || (value => new Date(value).toLocaleTimeString()))(options.retrievedAt)}`
    : "";
  return summary + partial + time;
}
