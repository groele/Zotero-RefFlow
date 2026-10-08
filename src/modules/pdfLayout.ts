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
  const rightStarts = entries.filter(entry => entry.x >= pageWidth * 0.45 && entry.x <= pageWidth * 0.8 && isReferenceStart(entry.text));
  const leftStarts = entries.filter(entry => entry.x < pageWidth * 0.45 && isReferenceStart(entry.text));
  // Repeated bibliography starts on both sides establish a real column boundary,
  // even when a long left-column string almost touches the right column.
  let split: number | undefined;
  if (rightStarts.length >= 2 && leftStarts.length >= 2) split = Math.min(...rightStarts.map(entry => entry.x)) - 4;
  if (split === undefined) {
    const candidates = entries.filter(entry => entry.x >= pageWidth * 0.45 && entry.x <= pageWidth * 0.8);
    const starts = new Map<number,number>();
    for (const entry of candidates) {
      const left = entries.some(other => Math.abs(other.y-entry.y) < 2 && other.x < pageWidth * 0.4 && other.x+other.width < entry.x-20);
      if (left) { const x=Math.round(entry.x/5)*5; starts.set(x,(starts.get(x)||0)+1); }
    }
    const repeated=[...starts].sort((a,b)=>b[1]-a[1])[0];
    if (repeated && repeated[1]>=3) split=repeated[0]-4;
  }
  type Line = Entry & {right:number; column:number};
  const lines: Line[] = [];
  const buckets = new Map<string,Line[]>();
  for (const entry of entries) {
    // A heading inside the right column must stay there (Nature Methods references).
    const column = isBibliographyHeading(entry.text) && (split===undefined||entry.x<split) ? -1 : split === undefined || entry.x < split ? 0 : 1;
    const bucket = Math.round(entry.y/4);
    const nearby=[bucket-1,bucket,bucket+1].flatMap(y=>buckets.get(`${column}:${y}`)||[]);
    let line=nearby.find(candidate => Math.abs(candidate.y-entry.y)<=Math.max(1.5,Math.min(candidate.height,entry.height)*0.45) && entry.x-candidate.right<=Math.max(35,entry.height*3));
    if (!line) {
      line={...entry,text:"",right:entry.x,column}; lines.push(line);
      const key=`${column}:${bucket}`; const group=buckets.get(key)||[];group.push(line);buckets.set(key,group);
    }
    const gap=entry.x-line.right;
    // PDF.js may split one word into glyph runs. Only add spaces at actual word gaps.
    line.text += (line.text && (line.spaceAfter || entry.spaceBefore || gap > Math.max(1,entry.height*0.12)) ? " " : "") + entry.text;
    line.spaceAfter=entry.spaceAfter;
    line.right=Math.max(line.right,entry.x+entry.width);line.height=Math.max(line.height,entry.height);
  }
  const headingY=lines.find(line=>line.column===-1)?.y;
  const group=(line:Line)=>headingY!==undefined && line.y>headingY+2?-2:line.column;
  return lines.sort((a,b)=>group(a)-group(b) || b.y-a.y || a.x-b.x)
    .map((line,order)=>({text:line.text.replace(/\s+/g," ").trim(),page,y:line.y,x:line.x,order,margin:line.y>pageHeight*0.955||line.y<pageHeight*0.045}));
}
