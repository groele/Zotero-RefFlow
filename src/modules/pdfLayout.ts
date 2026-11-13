import { isBibliographyHeading, isReferenceStart, ReferenceTextLine } from "./referenceExtractor";

/** Reconstruct column-aware reading order without joining adjacent columns. */
export function textItemsToLines(items: any[], page: number, pageWidth = 612, pageHeight=792): ReferenceTextLine[] {
  type Entry = { text: string; x: number; y: number; height: number; width: number; spaceBefore:boolean;spaceAfter:boolean };
  const entries: Entry[] = items.map(item => ({
    text: String(item.str || "").trim(),
    spaceBefore:/^\s/.test(item.str||""),spaceAfter:/\s$/.test(item.str||""),
    x: Number(item.transform?.[4]), y: Number(item.transform?.[5]),
    height: Math.max(1, Number(item.height) || Math.hypot(Number(item.transform?.[2]) || 0, Number(item.transform?.[3]) || 0)),
    width: Math.abs(Number(item.width) || 0)
  })).filter(entry => entry.text && Number.isFinite(entry.x) && Number.isFinite(entry.y))
    .sort((a,b) => b.y-a.y || a.x-b.x);
  const rowBuckets = new Map<number, Entry[]>();
  for (const entry of entries) {
    const key = Math.round(entry.y / 4);
    const rows = rowBuckets.get(key) || [];
    rows.push(entry);
    rowBuckets.set(key, rows);
  }
  const hasSameLineLeftNeighbor = (entry: Entry, minGap = 8) => {
    const bucket = Math.round(entry.y / 4);
    return [bucket - 1, bucket, bucket + 1].some(key =>
      (rowBuckets.get(key) || []).some(other =>
        other !== entry &&
        Math.abs(other.y - entry.y) <= Math.max(2, Math.min(other.height, entry.height) * 0.5) &&
        other.x < entry.x - 1 &&
        other.x + other.width >= entry.x - minGap
      )
    );
  };
  const crossesSplit = (candidate: number) =>
    entries.filter(entry =>
      !isBibliographyHeading(entry.text) &&
      entry.x < candidate - 4 &&
      entry.x + entry.width > candidate + 8
    ).length;

  const rightStarts = entries.filter(entry =>
    entry.x >= pageWidth * 0.44 &&
    entry.x <= pageWidth * 0.8 &&
    !hasSameLineLeftNeighbor(entry) &&
    isReferenceStart(entry.text)
  );
  const leftStarts = entries.filter(entry => entry.x < pageWidth * 0.44 && !hasSameLineLeftNeighbor(entry) && isReferenceStart(entry.text));
  // Repeated bibliography starts on both sides establish a real column boundary,
  // even when a long left-column string almost touches the right column.
  let split: number | undefined;
  if (rightStarts.length >= 2 && leftStarts.length >= 2) {
    const candidate = Math.min(...rightStarts.map(entry => entry.x)) - 4;
    if (candidate >= pageWidth * 0.40 && crossesSplit(candidate) <= 1) split = candidate;
  }
  if (split === undefined) {
    const candidates = entries.filter(entry => entry.x >= pageWidth * 0.44 && entry.x <= pageWidth * 0.8);
    const starts = new Map<number, number>();
    for (const entry of candidates) {
      const bucket = Math.round(entry.y / 4);
      const left = [bucket - 1, bucket, bucket + 1].some(key =>
        (rowBuckets.get(key) || []).some(other =>
          Math.abs(other.y - entry.y) <= 2.5 &&
          other.x < pageWidth * 0.44 &&
          other.x + other.width < entry.x - 10
        )
      );
      if (left && !hasSameLineLeftNeighbor(entry, 8)) {
        const x = Math.round(entry.x / 5) * 5;
        starts.set(x, (starts.get(x) || 0) + 1);
      }
    }
    const repeated = [...starts].sort((a, b) => b[1] - a[1])[0];
    if (repeated && repeated[1] >= (leftStarts.length >= 2 ? 2 : 3)) {
      const candidate = repeated[0] - 4;
      if (candidate >= pageWidth * 0.40 && crossesSplit(candidate) <= 1) split = candidate;
    }
  }
  type Line = Entry & {right:number; column:number; runs:Entry[]};
  const lines: Line[] = [];
  const buckets = new Map<string,Line[]>();
  const noHorizontalOverlap = (line: Line, entry: Entry) =>
    line.runs.every(run => entry.x >= run.x + run.width - 2 || entry.x + entry.width <= run.x + 2);
  const hasLeftOverlapOnRow = (entry: Entry) =>
    entries.some(other =>
      other !== entry &&
      split !== undefined &&
      other.x < split - 8 &&
      Math.abs(other.y - entry.y) <= Math.max(4, Math.min(other.height, entry.height))
    );
  for (const entry of entries) {
    // A centered/left bibliography heading spans the layout; keep right-column section headings (e.g. Nature Methods) in column 1.
    const heading = isBibliographyHeading(entry.text);
    const alignedWithRightColumn = heading && split !== undefined && entries.some(other =>
      other !== entry && other.x >= split && Math.abs(other.x - entry.x) <= 6
    );
    const isSpanningHeading = heading && (
      split === undefined ||
      entry.x < split ||
      (!alignedWithRightColumn && entry.x + entry.width > split && Math.abs(entry.x + entry.width / 2 - pageWidth / 2) <= 20 && !hasLeftOverlapOnRow(entry))
    );
    const column = isSpanningHeading ? -1 : split === undefined || entry.x < split ? 0 : 1;
    const bucket = Math.round(entry.y/4);
    const nearby=[bucket-1,bucket,bucket+1].flatMap(y=>buckets.get(`${column}:${y}`)||[]);
    let line=nearby.find(candidate => {
      const minH = Math.min(candidate.height, entry.height);
      const maxH = Math.max(candidate.height, entry.height);
      const dy = Math.abs(candidate.y - entry.y);
      const maxGap = candidate.text.length <= 8 ? Math.max(35, entry.height * 3) : Math.max(18, entry.height * 2.2);
      if (dy <= Math.max(1.5, minH * 0.45) && entry.x - candidate.right <= maxGap && (entry.x >= candidate.right - 2 || noHorizontalOverlap(candidate, entry))) return true;
      // Preserve inline subscripts/superscripts (e.g. MoS2) and leading superscript numbers on reference lines.
      if (minH < maxH * 0.9 && dy <= Math.max(2.5, maxH * 0.58) && noHorizontalOverlap(candidate, entry)) {
        if (entry.x >= candidate.x - 2 && entry.x <= candidate.right + Math.max(8, maxH)) return true;
        if (entry.height > candidate.height && entry.x <= candidate.x && candidate.x - (entry.x + entry.width) <= Math.max(8, maxH)) return true;
        if (candidate.runs.length === 1 && candidate.runs[0].text.length <= 5 && /^\d{1,4}[.)]?$/.test(candidate.runs[0].text) && entry.x >= candidate.right - 2 && entry.x - candidate.right <= Math.max(24, maxH * 2.5)) return true;
      }
      return false;
    });
    if (!line) {
      line={...entry,text:"",right:entry.x,column,runs:[]}; lines.push(line);
      const key=`${column}:${bucket}`; const group=buckets.get(key)||[];group.push(line);buckets.set(key,group);
    } else if (entry.height > line.height) {
      // Anchor line baseline & bucket tracking on the dominant text height rather than a leading script run.
      line.y = entry.y;
      const key = `${column}:${bucket}`;
      const group = buckets.get(key) || [];
      if (!group.includes(line)) { group.push(line); buckets.set(key, group); }
    }
    line.runs.push(entry);
    line.x = Math.min(line.x, entry.x);
    line.text += (line.text ? " " : "") + entry.text;
    line.right=Math.max(line.right,entry.x+entry.width);line.height=Math.max(line.height,entry.height);
  }
  const headingY=lines.find(line=>line.column===-1)?.y;
  const rightAboveAreRefs = headingY !== undefined && lines.some(line => line.column === 1 && line.y > headingY + 2 && isReferenceStart(line.text));
  const group=(line:Line)=>headingY!==undefined && line.y>headingY+2 && (!rightAboveAreRefs || line.column === 0)?-2:line.column;
  const formatLineText = (runs: Entry[]) => {
    const ordered = [...runs].sort((a, b) => a.x - b.x || b.y - a.y);
    let text = "";
    let prev: Entry | undefined;
    for (let idx = 0; idx < ordered.length; idx++) {
      const run = ordered[idx];
      if (prev) {
        const gap = run.x - (prev.x + prev.width);
        const isLeadingNumScript = idx === 1 && prev.height < run.height * 0.85 && /^\d{1,4}$/.test(prev.text) && /^[\p{L}\u4e00-\u9fff"“‘《\[]/u.test(run.text);
        const isSubOrSup = run.height < prev.height * 0.85 && gap <= Math.max(1.5, prev.height * 0.2);
        const isTrailingPunct = prev.height < run.height * 0.85 && /^[.,;:)\]]/.test(run.text) && gap <= Math.max(2.5, run.height * 0.3);
        // PDF.js may split one word into glyph runs. Only add spaces at actual word gaps.
        if (isLeadingNumScript || (!isSubOrSup && !isTrailingPunct && (prev.spaceAfter || run.spaceBefore || gap > Math.max(1, run.height * 0.12)))) {
          text += " ";
        }
      }
      text += run.text;
      prev = run;
    }
    return text.replace(/\s+/g, " ").trim();
  };
  return lines.sort((a,b)=>group(a)-group(b) || b.y-a.y || a.x-b.x)
    .map((line,order)=>({text:formatLineText(line.runs),page,y:line.y,x:line.x,order,margin:line.y>pageHeight*0.955||line.y<pageHeight*0.045}));
}
