/**
 * 参考文献排序引擎 (Reference Sorter Engine)
 * 支持三种核心排序维度：
 * 1. Original: 保持原始 PDF/全文书目中的自然出现次序
 * 2. Recency: 按发表年份由近及远降序排列
 * 3. Cited Count: 按学术影响力/被引用量降序排列
 */

export type SortMode = "Original" | "Recency" | "Cited Count";

export class ReferenceSorter {
  /**
   * 对文献列表按指定模式进行排序并返回新的排序数组
   */
  public static sort(references: ItemBaseInfo[], mode?: string): ItemBaseInfo[] {
    const sorted = [...references];
    if (mode === "Recency") {
      sorted.sort((a, b) => Number(b.year || 0) - Number(a.year || 0));
    } else if (mode === "Cited Count") {
      sorted.sort((a, b) => Number(b.citationCount || 0) - Number(a.citationCount || 0));
    }
    // "Original" 保持原数组次序
    return sorted;
  }
}

export default ReferenceSorter;
