import Requests from "./requests";
import CitationVerifier from "./verifier";

export interface RetractionCheckResult {
  isRetracted: boolean;
  reason?: string;
  updatedDate?: string;
}

export class RetractionChecker {
  private requests: Requests;

  constructor(requests?: Requests) {
    this.requests = requests || new Requests();
  }

  /**
   * 极速本地检测 (利用 Zotero 内置 Retraction Watch SQLite 本地库，耗时 0ms，0 网络开销)
   */
  public checkLocal(doi?: string): RetractionCheckResult {
    if (!doi) return { isRetracted: false };
    const cleanDoi = CitationVerifier.normalizeDOI(doi) || doi.trim().toLowerCase().replace(/^https?:\/\/doi\.org\//i, "").replace(/^doi:\s*/i, "");

    try {
      const zoteroAny = Zotero as any;
      if (zoteroAny.RetractionWatch) {
        if (typeof zoteroAny.RetractionWatch.checkDOI === "function") {
          const res = zoteroAny.RetractionWatch.checkDOI(cleanDoi);
          if (res) {
            const reason = typeof res === "object" ? (res.reason || res.details || res.notes) : undefined;
            const updatedDate = typeof res === "object" ? (res.date || res.updatedDate) : undefined;
            return {
              isRetracted: true,
              reason: reason || "Retracted by publisher (Retraction Watch)",
              updatedDate
            };
          }
        }
        if (typeof zoteroAny.RetractionWatch.checkItem === "function") {
          const fakeItem = {
            isRegularItem: () => true,
            isThesis: () => false,
            isAttachment: () => false,
            isNote: () => false,
            isAnnotation: () => false,
            getField: (f: string) => (f.toLowerCase() === "doi" ? cleanDoi : ""),
            getExtra: () => ""
          };
          const result = zoteroAny.RetractionWatch.checkItem(fakeItem);
          if (result && (result.isRetracted || result.retracted)) {
            const reason = typeof result === "object" ? (result.reason || result.details || result.notes) : undefined;
            const updatedDate = typeof result === "object" ? (result.date || result.updatedDate) : undefined;
            return {
              isRetracted: true,
              reason: reason || "Retracted by publisher (Retraction Watch)",
              updatedDate
            };
          }
        }
      }
    } catch (e) {
      // 容错处理
    }

    return { isRetracted: false };
  }

  /**
   * 检查指定 DOI 的撤稿状态与科研诚信警示
   * 优先秒级比对本地库，若指定 checkRemote 则可选联网核验 Crossmark 更新链与关系图谱
   */
  async checkDOI(doi?: string, checkRemote: boolean = false): Promise<RetractionCheckResult> {
    if (!doi) return { isRetracted: false };

    // 1. 本地极速核验
    const localResult = this.checkLocal(doi);
    if (localResult.isRetracted) {
      return localResult;
    }

    if (!checkRemote) {
      return { isRetracted: false };
    }

    // 2. 检查 Crossref 官方 Crossmark 更新链 (update-to) 与论文级撤回关系 (is-retracted-by)
    const cleanDoi = CitationVerifier.normalizeDOI(doi) || doi.trim().toLowerCase().replace(/^https?:\/\/doi\.org\//i, "").replace(/^doi:\s*/i, "");
    try {
      const path = cleanDoi.split("/").map(seg => encodeURIComponent(seg)).join("/");
      const url = `https://api.crossref.org/works/${path}?mailto=polite@zotero-ref.org`;
      const data = await this.requests.get(url);
      if (data && data.message) {
        // 检查 update-to (通告与更新)
        const updates = data.message["update-to"] || [];
        for (const update of updates) {
          const type = (update.type || "").toLowerCase();
          if (type.includes("retraction") || type.includes("withdrawal")) {
            return {
              isRetracted: true,
              reason: `Crossmark 撤稿记录: ${type}`,
              updatedDate: update.updated?.["date-time"]?.substring(0, 10)
            };
          }
        }

        // 检查 relation (原论文级关联: 被撤稿通知索引)
        const relations = data.message.relation || {};
        const retractedBy = relations["is-retracted-by"] || relations["is-withdrawn-by"];
        if (Array.isArray(retractedBy) && retractedBy.length > 0) {
          const noticeDoi = retractedBy[0]?.id || retractedBy[0]?.["id-value"] || "";
          return {
            isRetracted: true,
            reason: noticeDoi ? `Crossref 撤稿关联: ${noticeDoi}` : "Retracted by publisher (Crossref relation)"
          };
        }
      }
    } catch {
      // 忽略网络检测失败
    }

    return { isRetracted: false };
  }
}
export default RetractionChecker;
