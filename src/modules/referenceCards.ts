import { actionIcon } from "./cardActionIcon";
import { config } from "../../package.json";
import { getString } from "../utils/locale";
import type Views from "./views";
import type TipUI from "./tip";
import BatchImporter from "./batchImporter";
import BatchResults from "./batchResults";
import JournalStatus from "./journalStatus";
import { ListIndices } from "./listIndices";
import { referenceIdentity } from "./referenceIdentity";
import { cleanupSync } from "../utils/lifecycle";
import { openReferenceCardMenu, type CardFilterMode } from "./referenceCardMenu";
import { executeCardSettingsAction } from "./cardSettingsActions";
import { createReferenceCardRow, type CardRowContext } from "./referenceCardRow";
import { remountVirtualWindow, measureAverageRowHeight } from "./referenceCardsVirtual";

/** Compact reference cards and selection behavior aligned with the supplied XPI. */
export default class ReferenceCards {
  private migratedParents = new Set<number>();
  private refs: ItemBaseInfo[] = [];
  private batchResults: BatchResults;
  private journalStatus: JournalStatus;
  private selected = new Set<ItemBaseInfo>();
  private anchor = 0;
  private disposed = false;
  private searchTimer?: ReturnType<typeof globalThis.setTimeout>;
  private rows: HTMLElement[] = [];
  private observer?: IntersectionObserver;
  private matchQueue: Array<() => Promise<void>> = [];
  private matchActive = 0;
  private matchedRows = new WeakSet<HTMLElement>();
  private hoverTimer?: ReturnType<typeof globalThis.setTimeout>;
  private tip?: TipUI;
  private empty?: HTMLElement;
  private generation = 0;
  private matchGeneration = 0;
  private matchCurrent?: () => boolean;
  private providerRetractions = new WeakMap<ItemBaseInfo, ItemBaseInfo["retraction"]>();
  private menus = new Set<Element>();
  private cleanup: Array<() => void> = [];
  private listCurrent?: () => boolean;
  private windowStart = 0;
  private virtualCount = 0;
  private virtual = false;
  private rowHeight = 96;
  private indices = new ListIndices();
  private searchIndex = new WeakMap<ItemBaseInfo, string>();
  private filterMode: CardFilterMode = "all";
  private scrollRaf = 0;

  constructor(private views: Views, private body: HTMLElement, private grid: HTMLElement, private search: HTMLInputElement, listLabel = "Reference list") {
    this.batchResults = new BatchResults(views, body, grid);
    this.journalStatus = new JournalStatus(views, body, grid);
    const onInput = () => { globalThis.clearTimeout(this.searchTimer); this.searchTimer = globalThis.setTimeout(() => this.filter(), 80); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); globalThis.clearTimeout(this.searchTimer); search.value = ""; this.filter(); } };
    const onContextMenu = (event: MouseEvent) => { event.preventDefault(); this.menu(event); };
    search.addEventListener("input", onInput);
    search.addEventListener("keydown", onKeyDown);
    grid.setAttribute("role", "listbox"); grid.setAttribute("aria-multiselectable", "true");
    grid.addEventListener("contextmenu", onContextMenu);
    grid.setAttribute("aria-label", listLabel);
    const win = body.ownerDocument?.defaultView || globalThis;
    const onScroll = () => {
      if (!this.virtual || !this.listCurrent?.()) return;
      if (this.scrollRaf) return;
      this.scrollRaf = win.requestAnimationFrame(() => {
        this.scrollRaf = 0;
        if (!this.virtual || !this.listCurrent?.()) return;
        const start = Math.min(Math.max(0, Math.floor(grid.scrollTop / this.rowHeight) - 8), Math.max(0, this.virtualCount - 60));
        if (Math.abs(start - this.windowStart) < 8) return;
        this.windowStart = start;
        void remountVirtualWindow(this.asVirtualHost(), this.listCurrent);
      });
    };
    grid.addEventListener("scroll", onScroll, { passive: true });
    this.cleanup.push(() => { if (this.scrollRaf) win.cancelAnimationFrame(this.scrollRaf); grid.removeEventListener("scroll", onScroll); });
    this.cleanup.push(() => search.removeEventListener("input", onInput), () => search.removeEventListener("keydown", onKeyDown), () => grid.removeEventListener("contextmenu", onContextMenu));
  }

  dispose() { if (this.disposed) return; this.disposed = true; this.cleanup.forEach(cleanupSync); this.cleanup = []; for (const menu of this.menus) cleanupSync(() => menu.remove()); this.menus.clear(); globalThis.clearTimeout(this.searchTimer); this.clear(); }
  clear(preserveResults = false) { if (!preserveResults) { this.filterMode = "all"; this.indices = new ListIndices(); this.batchResults.clear(); this.journalStatus.clear(); } this.generation++; this.matchGeneration++; this.matchCurrent = undefined; this.listCurrent = undefined; this.windowStart = 0; this.virtualCount = 0; this.observer?.disconnect(); this.matchQueue = []; globalThis.clearTimeout(this.searchTimer); globalThis.clearTimeout(this.hoverTimer); this.clearTip(); this.selected.clear(); this.refs = []; this.rows = []; this.empty?.remove(); this.empty = undefined; this.grid.replaceChildren(); this.search.value = ""; }
  private clearTip() { const tip = this.tip; this.tip = undefined; if (tip) { globalThis.clearTimeout(tip.tipTimer); tip.clear(); } }
  private drainMatches() { while (this.matchActive < 4 && this.matchQueue.length) { const match = this.matchQueue.shift()!; this.matchActive++; void match().catch(error => ztoolkit.log(error)).finally(() => { this.matchActive--; if (!this.disposed) this.drainMatches(); }); } }
  private queueLibraryMatch(row: HTMLElement, parent: Zotero.Item, current: () => boolean) {
    if (this.matchedRows.has(row)) return;
    this.matchedRows.add(row);
    const ref = (row as any).reference;
    if (!this.providerRetractions.has(ref)) this.providerRetractions.set(ref, ref.retraction ? { ...ref.retraction } : undefined);
    const generation = this.matchGeneration, importRevision = row.dataset.importRevision;
    this.matchQueue.push(async () => {
      if (!current() || !row.isConnected) return;
      const found = await this.views.utils.searchLibraryItem({ ...ref, _item: undefined }, parent.libraryID);
      if (!current() || !row.isConnected || generation !== this.matchGeneration || importRevision !== row.dataset.importRevision || row.querySelector(".reference-action")?.hasAttribute("aria-busy")) return;
      ref._item = found;
      const local = found ? this.views.utils.API.retractionChecker.checkLocal(ref.identifiers?.DOI, found) : undefined;
      const provider = this.providerRetractions.get(ref);
      ref.retraction = provider?.isRetracted ? provider : local?.isRetracted ? local : provider;
      const action = row.querySelector<HTMLButtonElement>(".reference-action")!;
      const editable = Boolean(parent && !parent.deleted && (typeof parent.isEditable !== "function" || parent.isEditable()) && (Zotero as any).Libraries.get(parent.libraryID)?.editable !== false);
      actionIcon(action, found ? "open" : "add", getString(found ? "cards-show-library" : (editable ? "cards-import" : "cards-library-readonly")));
      action.disabled = Boolean(!found && !editable);
      const dot = row.querySelector<HTMLElement>(".reference-state")!;
      dot.style.backgroundColor = found ? "var(--color-accent, #3678b5)" : "var(--color-secondary, #9ca3af)"; dot.title = found ? getString("cards-in-library") : String(ref.year || "");
      row.style.opacity = found ? "1" : String(Zotero.Prefs.get(`${config.addonRef}.notInLibarayOpacity`) || "1");
      let warning = row.querySelector<HTMLElement>(".reference-retracted");
      if (ref.retraction?.isRetracted) { if (!warning) { warning = row.ownerDocument.createElement("span"); warning.className = "reference-retracted"; row.querySelector(".reference-description")!.prepend(warning); } warning.textContent = getString("relatedbox-retracted-badge"); warning.title = ref.retraction.reason || ""; }
      else warning?.remove();
    });
  }

  public invalidateLibraryMatches() {
    if (this.disposed || !this.matchCurrent?.() || !this.body.isConnected) return;
    const parent = this.parent(); if (!parent || parent.deleted) return;
    this.matchGeneration++; this.matchQueue = []; this.matchedRows = new WeakSet();
    for (const [index, row] of this.rows.entries()) {
      if ((row as any).reference._item?.deleted) (row as any).reference._item = undefined;
      if (index < 8) this.queueLibraryMatch(row, parent, this.matchCurrent);
      else this.observer?.observe(row);
    }
    this.drainMatches();
  }

  private parent(): Zotero.Item { return Zotero.Items.get(Number(this.body.getAttribute("data-refflow-item-id"))) as Zotero.Item; }
  private label(): HTMLElement { return this.body.querySelector("#reference-num")!; }
  private visible() { return this.rows.filter(row => !row.hidden); }
  private matches(ref: ItemBaseInfo): boolean {
    if (this.filterMode === "unimported" && ref._item) return false;
    if (this.filterMode === "imported" && !ref._item) return false;
    if (this.filterMode === "oa" && !ref.isOA && !ref.oaUrl) return false;
    if (this.filterMode === "retracted" && !ref.retraction?.isRetracted) return false;
    const query = this.search.value.trim().toLocaleLowerCase();
    if (!query) return true;
    let hay = this.searchIndex.get(ref);
    if (hay === undefined) {
      hay = [ref.text, ref.title, ...(ref.authors || []), ref.year, ref.publicationVenue, ref.identifiers?.DOI].join(" ").toLocaleLowerCase();
      this.searchIndex.set(ref, hay);
    }
    return query.split(/\s+/).filter(Boolean).every(token => hay!.includes(token));
  }
  private filtered() { return this.refs.filter(ref => this.matches(ref)); }
  private subset(): ItemBaseInfo[] { return this.selected.size ? [...this.selected] : this.filtered(); }
  private updateSelection() { for (const row of this.rows) { const selected = this.selected.has((row as any).reference); row.classList.toggle("selected", selected); row.setAttribute("aria-selected", String(selected)); } }
  private select(index: number, event: MouseEvent | KeyboardEvent) {
    const ref = this.refs[index];
    if (!ref) return;
    if (event.shiftKey) { if (!event.ctrlKey && !event.metaKey) this.selected.clear(); for (let i = Math.min(index, this.anchor); i <= Math.max(index, this.anchor); i++) if (this.matches(this.refs[i])) this.selected.add(this.refs[i]); }
    else if (event.ctrlKey || event.metaKey) { if (this.selected.has(ref)) this.selected.delete(ref); else this.selected.add(ref); this.anchor = index; }
    else { this.selected.clear(); this.selected.add(ref); this.anchor = index; }
    this.updateSelection();
  }
  private filter() {
    if (this.virtual) { this.windowStart = 0; this.grid.scrollTop = 0; for (const ref of this.selected) if (!this.matches(ref)) this.selected.delete(ref); if (this.listCurrent) void this.render(this.refs, this.listCurrent); return; }
    for (const row of this.rows) { const ref = (row as any).reference as ItemBaseInfo; row.hidden = !this.matches(ref); if (row.hidden) this.selected.delete(ref); }
    const visible = this.visible(); visible.forEach((row, index) => { row.setAttribute("aria-posinset", String(index + 1)); row.setAttribute("aria-setsize", String(visible.length)); });
    this.updateSelection(); this.label().textContent = `${visible.length} / ${this.rows.length} · ${this.body.getAttribute("data-refflow-result-source") || ""}`;
    if (this.empty) this.empty.hidden = this.visible().length > 0 || this.rows.length === 0;
  }

  private rowContext(): CardRowContext {
    const self = this;
    return {
      views: this.views,
      body: this.body,
      virtual: this.virtual,
      get rowHeight() { return self.rowHeight; },
      batchResults: this.batchResults,
      selected: this.selected,
      rows: this.rows,
      refs: this.refs,
      getTip: () => this.tip,
      setTip: (tip) => { this.tip = tip; },
      clearTip: () => this.clearTip(),
      setHoverTimer: (timer) => { this.hoverTimer = timer; },
      getHoverTimer: () => this.hoverTimer,
      select: (index, event) => this.select(index, event),
      open: (ref) => this.open(ref),
      filtered: () => this.filtered(),
      visible: () => this.visible(),
      updateSelection: () => this.updateSelection(),
      showJournal: () => { void this.journalStatus.show(); },
      label: () => this.label(),
      invalidateLibraryMatches: () => this.invalidateLibraryMatches(),
      parent: () => this.parent(),
      onVirtualJump: (refNext, focus) => {
        if (!this.listCurrent) return;
        this.windowStart = Math.max(0, this.filtered().indexOf(refNext) - 8);
        this.grid.scrollTop = this.windowStart * this.rowHeight;
        void remountVirtualWindow(this.asVirtualHost(), this.listCurrent).then(focus);
      },
    };
  }

  private asVirtualHost() {
    return this as unknown as import("./referenceCardsVirtual").VirtualWindowHost;
  }

  async render(refs: ItemBaseInfo[], current: () => boolean) {
    if (this.disposed) return;
    const parent = this.parent();
    if (parent?.id && !this.migratedParents.has(parent.id) && String(parent.getField("extra") || "").includes("refnexus_record_")) {
      try { await BatchImporter.migrateLegacy(parent); this.migratedParents.add(parent.id); } catch (error) { ztoolkit.log("Batch journal migration failed", error); new ztoolkit.ProgressWindow(getString("cards-batch-storage-error")).createLine({ text: getString("cards-batch-storage-preserved"), type: "fail" }).show(); }
      if (this.disposed || !current()) return;
    }
    const query = this.search.value;
    const sameList = refs === this.refs;
    const sameSelection = sameList ? [...this.selected] : [];
    const selected = new Set(sameList ? [] : [...this.selected].map(referenceIdentity));
    const active = this.grid.ownerDocument.activeElement as HTMLElement | null;
    const focused = active?.closest?.(".reference-item") as any;
    const focusKey = focused && this.grid.contains(focused) ? referenceIdentity(focused.reference) : undefined;
    const focusAction = active?.classList.contains("reference-action");
    const anchorKey = this.refs[this.anchor] ? referenceIdentity(this.refs[this.anchor]) : undefined;
    const scrollTop = this.grid.scrollTop;
    this.virtual = refs.length > 200;
    if (this.virtual) { const fontSize = parseFloat(this.body.ownerDocument.defaultView?.getComputedStyle(this.grid)?.fontSize || "13") || 13; this.rowHeight = Math.max(84, Math.ceil(fontSize * 6.5 + 10)); }
    const { indices, numbers, width } = this.indices.forList(refs, (this.body as any).references || refs, this.virtual ? query : "", ref => this.matches(ref), this.filterMode);
    const start = this.virtual ? Math.min(this.windowStart, Math.max(0, indices.length - 60)) : 0;
    const displayIndices = this.virtual ? indices.slice(start, start + 60) : indices;
    this.clear(true); this.search.value = query; this.refs = refs;
    this.listCurrent = current; this.windowStart = start; this.virtualCount = indices.length;
    const externalCurrent = current, generation = this.generation;
    current = () => externalCurrent() && this.generation === generation && !this.disposed;
    this.matchCurrent = current;
    const fragment = this.body.ownerDocument.createDocumentFragment();
    this.grid.style.maxHeight = this.virtual ? "65vh" : "";
    const spacer = (height: number) => { const node = this.body.ownerDocument.createElement("div"); node.style.height = `${height}px`; node.style.flexShrink = "0"; node.setAttribute("aria-hidden", "true"); return node; };
    const topSpacer = this.virtual ? spacer(start * this.rowHeight) : undefined;
    if (topSpacer) fragment.append(topSpacer);
    this.grid.style.setProperty("--refflow-number-width", width + "ch");
    if ((this.body.ownerDocument.defaultView as any).IntersectionObserver) this.observer = new (this.body.ownerDocument.defaultView as any).IntersectionObserver((entries: IntersectionObserverEntry[]) => {
      for (const entry of entries) if (entry.isIntersecting) { this.observer?.unobserve(entry.target); this.queueLibraryMatch(entry.target as HTMLElement, parent, current); }
      this.drainMatches();
    }, { rootMargin: "80px" });

    const ctx = this.rowContext();
    for (const [offset, index] of displayIndices.entries()) {
      const row = createReferenceCardRow(ctx, refs[index], numbers[index], this.virtual ? start + offset + 1 : index + 1, this.virtual ? indices.length : refs.length, current);
      this.rows.push(row);
      fragment.append(row);
      if (!this.virtual && index % 40 === 39) { await Zotero.Promise.delay(0); if (!current() || this.disposed) return; }
    }
    if (current() && !this.disposed) {
      const bottomSpacer = this.virtual ? spacer(Math.max(0, indices.length - start - displayIndices.length) * this.rowHeight) : undefined;
      if (bottomSpacer) fragment.append(bottomSpacer);
      this.grid.append(fragment);
      if (this.virtual) {
        const measured = measureAverageRowHeight(this.rows);
        if (measured > 0) {
          this.rowHeight = measured;
          if (topSpacer) topSpacer.style.height = `${start * measured}px`;
          if (bottomSpacer) bottomSpacer.style.height = `${Math.max(0, indices.length - start - displayIndices.length) * measured}px`;
        }
        this.grid.scrollTop = scrollTop;
      }
      this.empty = this.body.ownerDocument.createElement("p"); this.empty.className = "refflow-empty-result"; this.empty.setAttribute("role", "status"); this.empty.textContent = getString("cards-no-search-results"); this.empty.hidden = true; this.grid.after(this.empty);
      if (sameList) for (const ref of sameSelection) this.selected.add(ref);
      else {
        if (selected.size) for (const ref of refs) if (selected.has(referenceIdentity(ref))) this.selected.add(ref);
        this.anchor = anchorKey ? Math.max(0, refs.findIndex(ref => referenceIdentity(ref) === anchorKey)) : 0;
      }
      this.updateSelection();
      if ((query || this.filterMode !== "all") && !this.virtual) this.filter();
      if (this.virtual) { this.label().textContent = `${indices.length} / ${this.refs.length} · ${this.body.getAttribute("data-refflow-result-source") || ""}`; this.empty.hidden = indices.length > 0 || !this.refs.length; }
      const now = this.grid.ownerDocument.activeElement;
      if (focusKey && (!now || now === this.grid.ownerDocument.body || now === this.grid.ownerDocument.documentElement)) {
        const row = this.rows.find(row => !row.hidden && referenceIdentity((row as any).reference) === focusKey);
        (focusAction ? row?.querySelector<HTMLElement>(".reference-action") : row)?.focus();
      }
      for (const [index, row] of this.rows.entries()) {
        if (index < 8) this.queueLibraryMatch(row, parent, current);
        else this.observer?.observe(row);
      }
      this.drainMatches();
    }
  }
  updateStatus() { if (this.search.value.trim() && !this.virtual) this.filter(); }
  private open(ref: ItemBaseInfo) { if (ref._item) this.views.utils.selectItemInLibrary(ref._item, this.body.ownerDocument.defaultView!); else { const url = ref.url || (ref.identifiers?.DOI ? `https://doi.org/${ref.identifiers.DOI}` : undefined); if (url && /^https?:\/\//i.test(url)) Zotero.launchURL(url); } }
  public async runSettingsAction(action: string) {
    return executeCardSettingsAction(action, {
      disposed: this.disposed,
      body: this.body,
      parent: this.parent(),
      refs: [...this.refs],
      subset: this.subset(),
      selectedCount: this.selected.size,
      views: this.views,
      batchResults: this.batchResults,
      invalidateLibraryMatches: () => this.invalidateLibraryMatches(),
      label: () => this.label(),
      open: (ref) => this.open(ref)
    });
  }
  public closeQuickMenu() { for (const menu of this.menus) { (menu as any).hidePopup?.(); menu.remove(); } this.menus.clear(); }
  menu(event?: MouseEvent) {
    if (this.disposed) return;
    openReferenceCardMenu({
      views: this.views,
      body: this.body,
      menus: this.menus,
      parent: () => this.parent(),
      subset: () => this.subset(),
      all: () => [...this.refs],
      selectedCount: () => this.selected.size,
      label: () => this.label(),
      journalStatus: this.journalStatus,
      batchResults: this.batchResults,
      invalidateLibraryMatches: () => this.invalidateLibraryMatches(),
      openRef: (ref) => this.open(ref),
      getFilterMode: () => this.filterMode,
      setFilterMode: (mode) => { this.filterMode = mode; this.filter(); },
      isDisposed: () => this.disposed
    }, event);
  }
}
