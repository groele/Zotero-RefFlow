import { textItemsToLines } from "./pdfLayout";
import type { ReferenceTextLine } from "./referenceExtractor";

/** Adapt Zotero SDT 1.x text-map rows to the existing column-aware line parser. */
export function structuredPageToLines(blocks: unknown[], pageIndex: number, viewRect: number[]): ReferenceTextLine[] {
  const items: any[] = [];
  const visit = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.text === "string" && typeof node.anchor?.textMap === "string") {
      let rows: any;
      try { rows = JSON.parse(node.anchor.textMap); }
      catch { throw new Error("Invalid native structured PDF text map"); }
      if (!Array.isArray(rows)) throw new Error("Invalid native structured PDF text map");
      let cursor = 0;
      for (const row of rows) {
        if (!Array.isArray(row) || row.length < 7) continue;
        const start = cursor;
        // Each advance describes one non-space glyph; an array includes the
        // physical gap before it. SDT's text retains those intervening spaces.
        for (let glyph = 6; glyph < row.length; glyph++) {
          while (/\s/.test(node.text[cursor] || "") && cursor < node.text.length) cursor++;
          if (cursor < node.text.length) cursor += (node.text.codePointAt(cursor)! > 0xffff ? 2 : 1);
        }
        const str = node.text.slice(start, cursor);
        if (row[1] !== pageIndex || !str.trim()) continue;
        const gap = Array.isArray(row[6]) ? Number(row[6][0]) || 0 : 0;
        const width = row.slice(6).reduce((sum: number, advance: any) => sum +
          (Array.isArray(advance) ? Number(advance[0]) + Number(advance[1]) : Number(advance)), 0) - gap;
        const height = Math.max(1, Number(row[5]) - Number(row[3]));
        items.push({ str, width, height, transform: [height, 0, 0, height, Number(row[2]) + gap, Number(row[3])] });
      }
    }
    if (Array.isArray(node.content)) for (const child of node.content) visit(child);
  };
  for (const block of blocks) visit(block);
  return textItemsToLines(items, pageIndex + 1, Number(viewRect?.[2]) - Number(viewRect?.[0]) || 612,
    Number(viewRect?.[3]) - Number(viewRect?.[1]) || 792);
}
