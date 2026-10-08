import Requests from "./requests";
import CitationVerifier, { CandidateWork } from "./verifier";

export interface OpenAlexWorkSummary {
  openalexId: string;
  doi?: string;
  title: string;
  authors: string[];
  year?: string;
  venue?: string;
  isOA: boolean;
  oaUrl?: string;
  citationCount?: number;
  isRetracted?: boolean;
}

export class OpenAlexProvider {
  private requests: Requests;
  private mailto: string = "polite@zotero-ref.org";

  constructor(requests?: Requests) {
    this.requests = requests || new Requests();
  }

  /**
   * 通过 DOI 获取 OpenAlex Work 对象及其引用的文献列表 (referenced_works)
   */
  async getWorkByDOI(doi: string): Promise<{ work: any; referencedWorks: string[] } | undefined> {
    const cleanDoi = doi.trim().toLowerCase().replace(/^https?:\/\/doi\.org\//i, "").replace(/^doi:\s*/i, "");
    const selectFields = "id,doi,title,authorships,publication_year,primary_location,open_access,best_oa_location,cited_by_count,is_retracted,referenced_works";
    const url = `https://api.openalex.org/works/doi:${cleanDoi}?select=${selectFields}&mailto=${this.mailto}`;
    const data = await this.requests.get(url);
    if (!data || !data.id) return undefined;

    return {
      work: data,
      referencedWorks: Array.isArray(data.referenced_works) ? data.referenced_works : []
    };
  }

  /**
   * 批量高效水合 (Batch Hydration): 并发请求，单批50篇，并添加 select 字段瘦身 90%
   */
  async hydrateBatch(workUrls: string[]): Promise<OpenAlexWorkSummary[]> {
    if (!workUrls || workUrls.length === 0) return [];

    const cleanIds = workUrls
      .map(url => url.replace(/^https?:\/\/openalex\.org\//i, "").trim())
      .filter(Boolean);

    const chunks: string[][] = [];
    const chunkSize = 50;
    for (let i = 0; i < cleanIds.length; i += chunkSize) {
      chunks.push(cleanIds.slice(i, i + chunkSize));
    }

    const selectFields = "id,doi,title,authorships,publication_year,primary_location,open_access,best_oa_location,cited_by_count,is_retracted";

    // 并发执行所有 chunk 检索，极大缩减网络延迟
    const responses = await Promise.allSettled(
      chunks.map(chunk => {
        const filter = encodeURIComponent(`openalex:${chunk.join("|")}`);
        const url = `https://api.openalex.org/works?filter=${filter}&per-page=50&select=${selectFields}&mailto=${this.mailto}`;
        return this.requests.get(url);
      })
    );

    const summaries: OpenAlexWorkSummary[] = [];

    for (const res of responses) {
      if (res.status === "fulfilled" && res.value && Array.isArray(res.value.results)) {
        for (const item of res.value.results) {
          const authors = (item.authorships || [])
            .map((a: any) => a.author?.display_name)
            .filter(Boolean);

          let doi = item.doi ? item.doi.replace(/^https?:\/\/doi\.org\//i, "").replace(/^doi:\s*/i, "") : undefined;
          const isOA = Boolean(item.open_access?.is_oa);
          const oaUrl = item.open_access?.oa_url || item.best_oa_location?.pdf_url || undefined;
          const isRetracted = Boolean(item.is_retracted);

          summaries.push({
            openalexId: item.id,
            doi,
            title: item.title || "Untitled",
            authors,
            year: item.publication_year ? String(item.publication_year) : undefined,
            venue: item.primary_location?.source?.display_name,
            isOA,
            oaUrl,
            citationCount: item.cited_by_count,
            isRetracted
          });
        }
      }
    }

    // 恢复与原文章 referenced_works 完全一致的原始引用顺序
    const idOrderMap = new Map<string, number>();
    cleanIds.forEach((id, idx) => idOrderMap.set(id.toLowerCase(), idx));
    summaries.sort((a, b) => {
      const cleanA = a.openalexId.replace(/^https?:\/\/openalex\.org\//i, "").toLowerCase();
      const cleanB = b.openalexId.replace(/^https?:\/\/openalex\.org\//i, "").toLowerCase();
      return (idOrderMap.get(cleanA) ?? 99999) - (idOrderMap.get(cleanB) ?? 99999);
    });

    return summaries;
  }

  /**
   * 基于标题与作者在 OpenAlex 中执行零假阳性检索
   */
  async searchWorkByTitle(title: string, author?: string, year?: string): Promise<OpenAlexWorkSummary | undefined> {
    if (!title || title.trim().length < 5) return undefined;
    const cleanQuery = title.trim().slice(0, 100);
    const selectFields = "id,doi,title,authorships,publication_year,primary_location,open_access,best_oa_location,cited_by_count,is_retracted";
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(cleanQuery)}&per-page=3&select=${selectFields}&mailto=${this.mailto}`;
    const response = await this.requests.get(url);

    if (response && Array.isArray(response.results) && response.results.length > 0) {
      for (const item of response.results) {
        const authors = (item.authorships || [])
          .map((a: any) => a.author?.display_name)
          .filter(Boolean);

        const cand: CandidateWork = {
          title: item.title || "",
          authors,
          year: item.publication_year ? String(item.publication_year) : undefined,
          doi: item.doi ? item.doi.replace(/^https?:\/\/doi\.org\//i, "") : undefined
        };

        const result = CitationVerifier.evaluate({ title, author, year }, cand);
        if (result.status === "ACCEPT") {
          return {
            openalexId: item.id,
            doi: cand.doi,
            title: item.title || title,
            authors,
            year: cand.year ? String(cand.year) : undefined,
            venue: item.primary_location?.source?.display_name,
            isOA: Boolean(item.open_access?.is_oa),
            oaUrl: item.open_access?.oa_url || item.best_oa_location?.pdf_url || undefined,
            citationCount: item.cited_by_count,
            isRetracted: Boolean(item.is_retracted)
          };
        }
      }
    }
    return undefined;
  }
}
export default OpenAlexProvider;
