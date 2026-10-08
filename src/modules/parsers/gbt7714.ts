/**
 * GB/T 7714-2015 确定性中文引文文法解析器
 * 遵循国家标准《信息与文献 参考文献著录规则》
 */
export interface GBT7714Result {
  authors: string[];
  title: string;
  type: string; // Zotero itemType
  year?: string;
  source?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
  raw: string;
}

export class GBT7714Parser {
  // 国标文献类型标识符映射至 Zotero itemType
  private static typeMap: Record<string, string> = {
    J: "journalArticle",    // 期刊
    M: "book",              // 普通图书/专著
    C: "conferencePaper",   // 会议论文集/析出文献
    D: "thesis",            // 学位论文
    R: "report",            // 报告
    S: "standard",          // 标准
    P: "patent",            // 专利
    G: "document",          // 汇编
    N: "newspaperArticle",  // 报纸
    DB: "dataset",          // 数据库
    CP: "computerProgram",  // 计算机程序
    EB: "webpage"           // 电子公告/网页
  };

  /**
   * 检查文本是否符合 GB/T 7714 格式特征
   */
  public static isGBT7714(text: string): boolean {
    if (!text) return false;
    // 检查是否包含 [J], [M], [C], [D], [R], [EB/OL], [J/OL] 等标准文献标识
    return /\[(J|M|C|D|R|S|P|G|N|DB|CP|EB)(\/[A-Z]+)?\]/i.test(text);
  }

  /**
   * 解析单条 GB/T 7714 文本
   */
  public static parse(raw: string): GBT7714Result | null {
    if (!raw) return null;
    let text = raw.trim();

    // 剔除前导序号，如 [1], ［1］, 1., (1)
    text = text.replace(/^(\[\d+\]|［\d+］|\(\d+\)|\d+[\.、\s])\s*/, "").trim();

    // 提取可能的 DOI
    let doi: string | undefined;
    const doiMatch = text.match(/10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/);
    if (doiMatch) {
      doi = doiMatch[0].replace(/[.\s]+$/, "");
    }

    // 寻找文献类型标识符，如 [J], [M], [C], [D], [R], [EB/OL] 等
    const tagMatch = text.match(/\[([A-Za-z]{1,2})(?:\/([A-Za-z]+))?\]/);
    if (!tagMatch || tagMatch.index === undefined) {
      return this.parseLoose(text, doi, raw);
    }

    const typeCode = tagMatch[1].toUpperCase();
    const beforeTag = text.substring(0, tagMatch.index).trim();
    const metaPart = text.substring(tagMatch.index + tagMatch[0].length).replace(/^[.\u3002/\s]+/, "").trim();

    // 在 beforeTag 中智能分离作者与题名：
    // 排除西文姓名缩写点 (如 "J. A.," 或 "K. L.")，准确定位作者段与题名段的分界
    let authorPart = "";
    let titlePart = beforeTag;

    const etAlMatch = beforeTag.match(/^(.+?(?:et\s*al|等))\s*[.\u3002]\s*(.+)$/i);
    if (etAlMatch) {
      authorPart = etAlMatch[1].trim();
      titlePart = etAlMatch[2].trim();
    } else {
      // 匹配非缩写句点，或者单字母缩写点之后紧随的题名词汇 (大写单词、中文、书名引号)
      const splitRegex = /(?<!\b[A-Za-z])[.\u3002]\s+(?=[A-Z\u4e00-\u9fa5"“《])|(?<=\b[A-Za-z]\.)\s+(?=[A-Z][a-z]{2,}|\b[A-Z]{2,}\b|[\u4e00-\u9fa5"“《])/;
      const splitMatch = beforeTag.match(splitRegex);
      if (splitMatch && splitMatch.index !== undefined) {
        authorPart = beforeTag.substring(0, splitMatch.index).replace(/[.\u3002]$/, "").trim();
        titlePart = beforeTag.substring(splitMatch.index + splitMatch[0].length).trim();
      } else {
        const dotSpaceIndex = beforeTag.indexOf(". ");
        const chineseDotIndex = beforeTag.indexOf("。");
        let dotIndex = -1;
        let delimLength = 1;
        if (dotSpaceIndex > 0 && (chineseDotIndex === -1 || dotSpaceIndex < chineseDotIndex)) {
          dotIndex = dotSpaceIndex;
          delimLength = 2;
        } else if (chineseDotIndex > 0) {
          dotIndex = chineseDotIndex;
          delimLength = 1;
        }
        if (dotIndex > 0) {
          authorPart = beforeTag.substring(0, dotIndex).trim();
          titlePart = beforeTag.substring(dotIndex + delimLength).trim();
        } else {
          authorPart = beforeTag;
          titlePart = beforeTag;
        }
      }
    }

    // 解析作者 (以逗号或分号分割，智能合并姓氏与首字母缩写)
    const rawTokens = authorPart
      .split(/[,，;；]/)
      .map(a => a.trim())
      .filter(a => a.length > 0 && !/et\s*al|等$/i.test(a));

    const authors: string[] = [];
    for (let i = 0; i < rawTokens.length; i++) {
      const tok = rawTokens[i];
      // 如果当前 token 是单字母或单字母缩写 (如 "A." 或 "J")，且前一个作者较长，则合并到前一个作者
      if (/^[A-Za-z](\.|\b)$/.test(tok) && authors.length > 0) {
        authors[authors.length - 1] = `${authors[authors.length - 1]} ${tok}`;
      } else {
        authors.push(tok);
      }
    }

    // 若末位作者以单个西文首字母结尾 (如 "Brown K. L")，恢复其缩写点
    if (authors.length > 0 && /\b[A-Za-z]$/.test(authors[authors.length - 1])) {
      authors[authors.length - 1] += ".";
    }

    // 映射类型
    const type = this.typeMap[typeCode] || "journalArticle";

    // 从出版信息中提取年份 (4位连续数字 1900-2099)
    let year: string | undefined;
    const yearMatch = metaPart.match(/\b(19\d\d|20\d\d)\b/);
    if (yearMatch) {
      year = yearMatch[1];
    }

    // 提取卷、期、页码
    let volume: string | undefined;
    let issue: string | undefined;
    let pages: string | undefined;

    // 常见格式: 2021, 38(4): 12-18 或 2020(2): 45-50
    const volIssueMatch = metaPart.match(/(\d+)?\s*\(([^)]+)\)\s*:\s*([\d\-–—]+)/);
    if (volIssueMatch) {
      volume = volIssueMatch[1];
      issue = volIssueMatch[2];
      pages = volIssueMatch[3];
    } else {
      const pageMatch = metaPart.match(/:\s*([\d\-–—]+)/);
      if (pageMatch) {
        pages = pageMatch[1];
      }
    }

    // 提取整洁的出版物/期刊/出版社名称
    let cleanSource = metaPart.trim();
    if (typeCode === "J") {
      const journalMatch = metaPart.match(/^([^,，.。]+?)(?:[,，.。]\s*(?:19\d\d|20\d\d)|\s*\(?(?:19\d\d|20\d\d))/);
      if (journalMatch) {
        cleanSource = journalMatch[1].trim();
      }
    } else if (typeCode === "M") {
      const pubMatch = metaPart.match(/(?::\s*|：\s*)([^,，.。]+?)(?:[,，.。]\s*(?:19\d\d|20\d\d)|$)/);
      if (pubMatch) {
        cleanSource = pubMatch[1].trim();
      } else {
        const parts = metaPart.split(/[,，.。]/).map(s => s.trim()).filter(Boolean);
        if (parts.length > 0) cleanSource = parts[0];
      }
    } else if (typeCode === "C") {
      const confMatch = metaPart.match(/(?:\/\/)?([^,，.。]+?)(?:[,，.。]\s*(?:19\d\d|20\d\d)|$)/);
      if (confMatch) {
        cleanSource = confMatch[1].replace(/^\/\/\s*/, "").trim();
      }
    } else if (typeCode === "D") {
      const univMatch = metaPart.match(/(?::\s*|：\s*)([^,，.。]+?)(?:[,，.。]\s*(?:19\d\d|20\d\d)|$)/) ||
        metaPart.match(/^([^,，.。]+?)(?:[,，.。]\s*(?:19\d\d|20\d\d)|$)/);
      if (univMatch) {
        cleanSource = univMatch[1].trim();
      }
    }

    return {
      authors: authors.length > 0 ? authors : [authorPart.trim()],
      title: titlePart.trim(),
      type,
      year,
      source: cleanSource,
      volume,
      issue,
      pages,
      doi,
      raw
    };
  }

  /**
   * 宽松模式降级解析 (支持无显式 [J]/[M] 标签的规范引文)
   */
  public static parseLoose(text: string, doi: string | undefined, raw: string): GBT7714Result | null {
    if (!text || text.trim().length < 5) return null;
    let clean = text.replace(/^[.\s]+/, "").trim();

    // 尝试寻找年份
    const yearMatch = clean.match(/\b(19\d\d|20\d\d)\b/);
    const year = yearMatch ? yearMatch[1] : undefined;

    // 尝试按句点或中文句号拆分作者、标题与出版信息
    const segments = clean
      .split(/(?<!\b[A-Za-z])[.\u3002]\s+|(?<=\b[A-Za-z]\.)\s+(?=[A-Z\u4e00-\u9fa5])/)
      .map(s => s.trim())
      .filter(Boolean);

    if (segments.length >= 2) {
      const authorPart = segments[0];
      const title = segments[1];
      const source = segments.slice(2).join(". ");
      const authors = authorPart
        .split(/[,，;；]/)
        .map(a => a.trim())
        .filter(a => a.length > 0 && !/et\s*al|等$/i.test(a));

      return {
        authors: authors.length > 0 ? authors : [authorPart],
        title,
        type: "journalArticle",
        year,
        source: source || undefined,
        doi,
        raw
      };
    }

    return null;
  }
}
export default GBT7714Parser;
