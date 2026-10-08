/**
 * 确定性引文校验与多维加权打分矩阵
 * 依据 DOI、题名、作者与年份筛选候选；评分不能保证零误匹配
 */

export interface CandidateWork {
  doi?: string;
  title: string;
  authors?: string[];
  year?: number | string;
  venue?: string;
  source?: string;
}

export interface VerificationResult {
  score: number;
  status: "ACCEPT" | "REVIEW" | "REJECT";
  reasons: string[];
  normalizedTitle: string;
}

export class CitationVerifier {
  /**
   * 规范化 DOI 字符串
   * 抹平 URL 前缀、大小写、前后标点空格
   */
  public static normalizeDOI(doi?: string): string | undefined {
    if (!doi) return undefined;
    let clean = doi.trim().toLowerCase();
    try {
      clean = decodeURIComponent(clean);
    } catch {}
    clean = clean.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
    clean = clean.replace(/^doi:\s*/i, "");
    clean = clean.replace(/^[\s(\[{<"']+|[.\s,;:()\[\]}>"']+$/g, "");
    const match = clean.match(/10\.\d{4,9}\/[-._;()/:a-z0-9]+/);
    if (!match) return undefined;
    let result = match[0];
    if (result.endsWith(")") && !result.includes("(")) {
      result = result.slice(0, -1);
    }
    if (result.endsWith("]") && !result.includes("[")) {
      result = result.slice(0, -1);
    }
    return result.replace(/[.\s,;:]+$/, "");
  }

  /**
   * 字符串 Token 规范化清洗 (用于比较标题)
   * 自动剔除 XML/HTML 标签、解析转义实体、剔除 LaTeX 数学公式与标点
   */
  public static cleanTitle(title?: string): string {
    if (!title) return "";
    return title
      .replace(/<[^>]+>/g, " ") // 剔除 HTML/XML 标签 (如 <jats:title>, <i>)
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\$[^$]*\$/g, " ") // 剔除 $...$ 之间的 LaTeX 算式
      .replace(/\\\([^\)]*\\\)/g, " ") // 剔除 \(...\) 之间的 LaTeX 算式
      .toLowerCase()
      .normalize("NFKD") // 统一 Unicode 变音符号
      .replace(/\\[a-zA-Z]+(\{.*?\})?/g, " ") // 剔除 LaTeX 指令及参数 (如 \mathcal{O}, \sqrt{x})
      .replace(/[\$\{\}]/g, "") // 剔除残余 LaTeX 数学标记
      .replace(/[\u2018\u2019\u201c\u201d"'`《》]/g, "") // 统一所有引号与书名号
      .replace(/[^\w\s\u4e00-\u9fa5]/g, " ") // 非文字标点变空格
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * 中英双语智能分词：
   * 英文/西文提取独立词根；中文提取单字及 2-gram (二元滑动窗口)，彻底解决中文学术标题相似度计算问题
   */
  public static tokenize(title?: string): Set<string> {
    const cleaned = this.cleanTitle(title);
    if (!cleaned) return new Set();

    const stopWords = new Set(["the", "of", "in", "on", "at", "and", "a", "an", "for", "with", "by", "from", "to", "as", "is", "are", "was", "were"]);
    const tokens = new Set<string>();

    // 1. 英文/数字 token 按空格提取
    const words = cleaned.split(/\s+/).filter(w => w.length > 1 && !stopWords.has(w));
    for (const w of words) {
      if (!/[\u4e00-\u9fa5]/.test(w)) {
        tokens.add(w);
      }
    }

    // 2. 中文字符：提取汉字与 2-gram 滑动词组
    const chineseChars = cleaned.match(/[\u4e00-\u9fa5]/g) || [];
    for (let i = 0; i < chineseChars.length; i++) {
      tokens.add(chineseChars[i]);
      if (i + 1 < chineseChars.length) {
        tokens.add(chineseChars[i] + chineseChars[i + 1]);
      }
    }

    return tokens;
  }

  /**
   * 计算 Token Jaccard 与子标题包含度 (Token Set Containment)
   * 有效解决学术数据库中副标题 (Subtitle) 增减导致的匹配失败
   */
  public static tokenJaccard(s1: string, s2: string): number {
    const t1 = this.cleanTitle(s1);
    const t2 = this.cleanTitle(s2);
    if (!t1 || !t2) return 0;
    if (t1 === t2) return 1.0;

    const set1 = this.tokenize(s1);
    const set2 = this.tokenize(s2);

    if (set1.size === 0 || set2.size === 0) return 0;

    let intersection = 0;
    for (const item of set1) {
      if (set2.has(item)) intersection++;
    }

    const union = set1.size + set2.size - intersection;
    const jaccard = union === 0 ? 0 : intersection / union;

    // 针对学术副标题 (Subtitle) 包含度检测：
    // 若较短标题的核心关键词完全或几乎完全 (>=88%) 被较长标题所包含，赋予高匹配度
    const minSize = Math.min(set1.size, set2.size);
    if (minSize >= 2) {
      const containment = intersection / minSize;
      if (containment >= 0.88) {
        return Math.max(jaccard, 0.90);
      }
    }

    // 检查副标题分隔符 (冒号或破折号) 截断前的主标题
    const prefix1 = s1.split(/[:\u2014\-]/)[0]?.trim();
    const prefix2 = s2.split(/[:\u2014\-]/)[0]?.trim();
    if (prefix1 && prefix2 && (prefix1 !== s1 || prefix2 !== s2)) {
      const pset1 = this.tokenize(prefix1);
      const pset2 = this.tokenize(prefix2);
      if (pset1.size >= 2 && pset2.size >= 2) {
        let pIntersection = 0;
        for (const item of pset1) {
          if (pset2.has(item)) pIntersection++;
        }
        const pUnion = pset1.size + pset2.size - pIntersection;
        const pJaccard = pUnion === 0 ? 0 : pIntersection / pUnion;
        if (pJaccard >= 0.80) {
          return Math.max(jaccard, 0.88);
        }
      }
    }

    return jaccard;
  }

  /**
   * 提取作者关键姓氏 Token 列表
   */
  public static extractSurnameTokens(authorStr?: string): string[] {
    if (!authorStr) return [];
    const cleaned = authorStr
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s\u4e00-\u9fa5]/g, " ");

    const tokens = new Set<string>();

    // 1. 常规分词
    const parts = cleaned.split(/\s+/).filter(Boolean);
    for (const w of parts) {
      if (/[\u4e00-\u9fa5]/.test(w)) {
        tokens.add(w);
      } else if (w.length >= 2 && !["et", "al", "and", "the", "von", "van", "der", "de"].includes(w)) {
        tokens.add(w);
      }
    }

    // 2. 中文姓名强化：提取去空格后的紧凑全名与首字姓氏
    const chineseAll = cleaned.replace(/[^\u4e00-\u9fa5]/g, "");
    if (chineseAll.length >= 2 && chineseAll.length <= 4) {
      tokens.add(chineseAll); // 如 "张宁"
      tokens.add(chineseAll[0]); // 首字姓氏 如 "张"
    } else if (chineseAll.length === 1) {
      tokens.add(chineseAll);
    }

    return Array.from(tokens);
  }

  /**
   * 作者姓氏 (Surname) 匹配度
   * 杜绝单/双字母子串误匹配 (如 "Li" 误匹配 "Williams")
   */
  public static authorMatch(extractedAuthor?: string, candidateAuthors?: string[]): number {
    if (!extractedAuthor || !candidateAuthors || candidateAuthors.length === 0) {
      return 0.5; // 未提供作者时不扣死分，给予中立分
    }

    const targetTokens = this.extractSurnameTokens(extractedAuthor);
    if (targetTokens.length === 0) return 0.5;

    const candTokens = candidateAuthors.flatMap(a => this.extractSurnameTokens(a));
    if (candTokens.length === 0) return 0.5;

    // 1. 优先检查精确 Token 重合
    for (const t of targetTokens) {
      if (candTokens.includes(t)) {
        return 1.0;
      }
    }

    // 2. 次级检查：仅在长度 >= 4 且长度差不超过 2 时允许前缀/复合姓氏匹配
    for (const t of targetTokens) {
      for (const c of candTokens) {
        if (t.length >= 4 && c.length >= 4 && Math.abs(t.length - c.length) <= 2) {
          if (c.startsWith(t) || t.startsWith(c)) {
            return 0.85;
          }
        }
      }
    }
    return 0.0;
  }

  /**
   * 年份匹配度 (允许 ±1~2 年的预印本/见刊跨年误差)
   */
  public static yearMatch(y1?: number | string, y2?: number | string): number {
    if (!y1 || !y2) return 0.6; // 缺失年份时中立分
    const n1 = parseInt(String(y1).match(/\b(19\d\d|20\d\d)\b/)?.[0] || "0");
    const n2 = parseInt(String(y2).match(/\b(19\d\d|20\d\d)\b/)?.[0] || "0");
    if (!n1 || !n2) return 0.6;

    const diff = Math.abs(n1 - n2);
    if (diff === 0) return 1.0;
    if (diff === 1) return 0.75; // 预印本与见刊常见跨年
    if (diff === 2) return 0.40; // 跨度2年给予合理过渡分，避免阻断高相似度标题
    return 0.0;
  }

  /**
   * 核心加权评估矩阵
   */
  public static evaluate(
    extracted: { title: string; author?: string; year?: number | string; doi?: string },
    candidate: CandidateWork
  ): VerificationResult {
    const reasons: string[] = [];

    // 若 DOI 直接完全一致，100% 确认
    const normExtDoi = this.normalizeDOI(extracted.doi);
    const normCandDoi = this.normalizeDOI(candidate.doi);
    if (normExtDoi && normCandDoi && normExtDoi === normCandDoi) {
      return {
        score: 1.0,
        status: "ACCEPT",
        reasons: ["Exact DOI match verified"],
        normalizedTitle: candidate.title
      };
    }
    if(normExtDoi && normCandDoi && normExtDoi!==normCandDoi) {
      return {score:0,status:"REJECT",reasons:["Rejected: conflicting DOI identifiers"],normalizedTitle:candidate.title};
    }

    // 1. 标题分 (权重 0.55)
    const titleScore = this.tokenJaccard(extracted.title, candidate.title);
    reasons.push(`Title Jaccard: ${(titleScore * 100).toFixed(1)}%`);

    // 2. 作者分 (权重 0.25)
    const authorScore = this.authorMatch(extracted.author, candidate.authors);
    reasons.push(`Author Match: ${(authorScore * 100).toFixed(0)}%`);

    // 3. 年份分 (权重 0.20)
    const yearScore = this.yearMatch(extracted.year, candidate.year);
    reasons.push(`Year Match: ${(yearScore * 100).toFixed(0)}%`);

    // 综合加权
    const finalScore = (0.55 * titleScore) + (0.25 * authorScore) + (0.20 * yearScore);

    // 硬门禁断言：标题分低于 0.65 绝不允许通过
    let status: "ACCEPT" | "REVIEW" | "REJECT" = "REJECT";
    if (titleScore < 0.65) {
      status = "REJECT";
      reasons.push("Rejected: Title similarity below threshold (0.65)");
    } else if (finalScore >= 0.85) {
      status = "ACCEPT";
    } else if (finalScore >= 0.68) {
      status = "REVIEW";
    } else {
      status = "REJECT";
    }

    return {
      score: parseFloat(finalScore.toFixed(3)),
      status,
      reasons,
      normalizedTitle: candidate.title
    };
  }
}
export default CitationVerifier;
