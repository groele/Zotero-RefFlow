import { ListIndices } from "./listIndices";
import { createReferenceCardRow, type CardRowContext } from "./referenceCardRow";
import { rebindReferenceCardRow } from "./referenceCardRebind";

export interface VirtualWindowHost {
  disposed: boolean;
  virtual: boolean;
  refs: ItemBaseInfo[];
  rows: HTMLElement[];
  body: HTMLElement;
  grid: HTMLElement;
  search: HTMLInputElement;
  filterMode: string;
  indices: ListIndices;
  selected: Set<ItemBaseInfo>;
  matchedRows: WeakSet<HTMLElement>;
  rowHeight: number;
  windowStart: number;
  virtualCount: number;
  empty?: HTMLElement;
  observer?: IntersectionObserver;
  rowContext: () => CardRowContext;
  parent: () => Zotero.Item;
  matches: (ref: ItemBaseInfo) => boolean;
  queueLibraryMatch: (row: HTMLElement, parent: Zotero.Item, current: () => boolean) => void;
  drainMatches: () => void;
  label: () => HTMLElement;
}

/** Measure average rendered row height when layout geometry is available; returns 0 otherwise. */
export function measureAverageRowHeight(rows: HTMLElement[]): number {
  let total = 0;
  let count = 0;
  for (const row of rows) {
    const measured = Math.max(
      Number(row.offsetHeight || 0),
      typeof row.getBoundingClientRect === "function" ? Number(row.getBoundingClientRect()?.height || 0) : 0,
    );
    if (Number.isFinite(measured) && measured > 0) {
      total += measured;
      count++;
    }
  }
  return count ? Math.max(64, Math.round(total / count)) : 0;
}

/** Scroll window update: reuse cards for stable refs so library matches survive. */
export async function remountVirtualWindow(host: VirtualWindowHost, current: () => boolean) {
  if (host.disposed || !host.virtual || !current()) return;
  const parent = host.parent();
  const query = host.search.value;
  const scrollTop = host.grid.scrollTop;
  const { indices, numbers, width } = host.indices.forList(
    host.refs,
    (host.body as any).references || host.refs,
    query,
    (ref) => host.matches(ref),
    host.filterMode,
  );
  const start = Math.min(host.windowStart, Math.max(0, indices.length - 60));
  const displayIndices = indices.slice(start, start + 60);
  host.windowStart = start;
  host.virtualCount = indices.length;
  host.observer?.disconnect();
  host.grid.style.setProperty("--refflow-number-width", width + "ch");
  const pool = new Map(host.rows.map((row) => [(row as any).reference as ItemBaseInfo, row]));
  const reusedCandidates = displayIndices
    .map((index) => pool.get(host.refs[index]))
    .filter((row): row is HTMLElement => Boolean(row));
  const anchorRow = reusedCandidates[Math.floor(reusedCandidates.length / 2)];
  const anchorBeforeTop =
    anchorRow && scrollTop > 0 && typeof anchorRow.offsetTop === "number" ? anchorRow.offsetTop : undefined;
  const nextRows: HTMLElement[] = [];
  const changed = new Set<HTMLElement>();
  const fragment = host.body.ownerDocument.createDocumentFragment();
  const spacer = (height: number) => {
    const node = host.body.ownerDocument.createElement("div");
    node.style.height = `${height}px`;
    node.style.flexShrink = "0";
    node.setAttribute("aria-hidden", "true");
    return node;
  };
  if ((host.body.ownerDocument.defaultView as any).IntersectionObserver) {
    host.observer = new (host.body.ownerDocument.defaultView as any).IntersectionObserver((entries: IntersectionObserverEntry[]) => {
      for (const entry of entries) if (entry.isIntersecting) {
        host.observer?.unobserve(entry.target);
        host.queueLibraryMatch(entry.target as HTMLElement, parent, current);
      }
      host.drainMatches();
    }, { rootMargin: "80px" });
  }
  fragment.append(spacer(start * host.rowHeight));
  const ctx = host.rowContext();
  for (const [offset, index] of displayIndices.entries()) {
    const ref = host.refs[index];
    let row = pool.get(ref);
    if (row) {
      pool.delete(ref);
      if (rebindReferenceCardRow(row, ref, numbers[index], start + offset + 1, indices.length, host.selected.has(ref), parent)) {
        host.matchedRows.delete(row);
        changed.add(row);
      }
    } else {
      row = createReferenceCardRow(ctx, ref, numbers[index], start + offset + 1, indices.length, current);
      changed.add(row);
    }
    nextRows.push(row);
    fragment.append(row);
  }
  fragment.append(spacer(Math.max(0, indices.length - start - displayIndices.length) * host.rowHeight));
  if (!current() || host.disposed) return;
  host.rows = nextRows;
  host.grid.replaceChildren();
  host.grid.append(fragment);
  if (anchorRow && anchorBeforeTop !== undefined && typeof anchorRow.offsetTop === "number") {
    host.grid.scrollTop = Math.max(0, scrollTop + (anchorRow.offsetTop - anchorBeforeTop));
  } else {
    host.grid.scrollTop = scrollTop;
  }
  const avg = measureAverageRowHeight(host.rows);
  if (avg > 0) host.rowHeight = avg;
  host.label().textContent = `${indices.length} / ${host.refs.length} · ${host.body.getAttribute("data-refflow-result-source") || ""}`;
  if (host.empty) host.empty.hidden = indices.length > 0 || !host.refs.length;
  for (const [index, row] of host.rows.entries()) {
    if (!changed.has(row) && host.matchedRows.has(row)) continue;
    if (index < 8) host.queueLibraryMatch(row, parent, current);
    else host.observer?.observe(row);
  }
  host.drainMatches();
}
