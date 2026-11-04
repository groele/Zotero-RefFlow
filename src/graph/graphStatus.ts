export type GraphStatusOptions = {
  source?: string;
  partialOrigins?: number;
  retrievedAt?: string;
  language?: string;
  formatTime?: (timestamp: string) => string;
};

export function formatGraphStatus(papers: number, relationships: number, options: GraphStatusOptions = {}): string {
  const chinese = String(options.language || "").toLowerCase().startsWith("zh");
  const source = options.source || "Connected Papers";
  const summary = `${papers} ${chinese ? "篇文献" : "papers"} · ${relationships} ${chinese ? "条相似关系" : "similarity links"} · ${source}`;
  const partial = options.partialOrigins
    ? ` · ${chinese ? "未解析起点" : "unresolved origins"} ${options.partialOrigins}`
    : "";
  const time = options.retrievedAt
    ? ` · ${(options.formatTime || (value => new Date(value).toLocaleTimeString()))(options.retrievedAt)}`
    : "";
  return summary + partial + time;
}
