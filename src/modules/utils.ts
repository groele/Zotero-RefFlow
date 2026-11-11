import API from "./api"
import PDF from "./pdf";
import ReferenceParser from "./referenceParser";
import CitationVerifier from "./verifier";
import {workIdentity,selectLibraryMatch} from './workIdentity';
import LibraryMatchIndex from "./libraryIndex";

class Utils {
  API: API;
  PDF: PDF;
  private itemCache: Map<string, Zotero.Item | null> = new Map();
  private readonly MAX_ITEM_CACHE: number = 800;
  private itemCacheGeneration = 0;
  private libraryGenerations=new Map<number,number>();
  private itemFlights = new Map<string, Promise<Zotero.Item | undefined>>();
  private matchIndex = new LibraryMatchIndex();

  public clearLibraryItemCache(libraryIDs?:Set<number>): void {
    this.matchIndex.clear(libraryIDs);
    if(libraryIDs){
      for(const id of libraryIDs)this.libraryGenerations.set(id,(this.libraryGenerations.get(id)||0)+1);
      for(const key of this.itemCache.keys())if(libraryIDs.has(Number(key.split(':')[0])))this.itemCache.delete(key);
      for(const key of this.itemFlights.keys())if(libraryIDs.has(Number(key.split(':')[0])))this.itemFlights.delete(key);
    }else{this.itemCache.clear();this.itemCacheGeneration++;this.libraryGenerations.clear();this.itemFlights.clear();}
  }
  public get regex() { return ReferenceParser.regex; }
  constructor() {
    this.API = new API(this);
    this.PDF = new PDF(this);
  }

  public getIdentifiers(text: string): ItemBaseInfo["identifiers"] {
    return ReferenceParser.getIdentifiers(text);
  }

  public extractURL(text: string): string | undefined {
    return ReferenceParser.extractURL(text);
  }

  public parseRefText(text: string) {
    return ReferenceParser.parseRefText(text);
  }

  public _parseRefText(text: string) {
    return ReferenceParser._parseRefText(text);
  }

  public identifiers2URL(identifiers: ItemBaseInfo["identifiers"]) {
    return ReferenceParser.identifiers2URL(identifiers);
  }

  public refText2Info(text: string): ItemBaseInfo {
    return ReferenceParser.refText2Info(text);
  }

  public parseCNKIURL(cnkiURL: string) {
    return ReferenceParser.parseCNKIURL(cnkiURL);
  }

  public splitCreator(authorStr: string): any {
    return ReferenceParser.splitCreator(authorStr);
  }

  public searchRelatedItem(item: Zotero.Item, refItem: Zotero.Item): Zotero.Item | undefined {
    if (!item || !refItem) { return; }
    const libId = item.libraryID || 1;
    let relatedItems = item.relatedItems.map(key => {
      try {
        return Zotero.Items.getByLibraryAndKey(libId, key) as Zotero.Item;
      } catch {
        return undefined;
      }
    }).filter(Boolean) as Zotero.Item[];
    return relatedItems.find((relItem: Zotero.Item) => refItem.id === relItem.id);
  }

  public async searchItem(info: ItemBaseInfo, libraryID?: number) {
    if (!info) { return; }
    let s = new (Zotero as any).Search();
    const resolvedLibrary=libraryID || this.resolveLibraryID();
    if(!resolvedLibrary)return;
    s.libraryID = resolvedLibrary;
    // @ts-ignore
    s.addCondition("joinMode", "any");
      s.addCondition("resultLevel", "item");

    let hasCondition = false;
    if (info.identifiers?.DOI) {
      const cleanDOI = CitationVerifier.normalizeDOI(info.identifiers.DOI) || info.identifiers.DOI.trim();
      s.addCondition("DOI", "is", cleanDOI);
      s.addCondition("DOI", "contains", cleanDOI);
      hasCondition = true;
    }
    const titleCandidate = info.title || (info.text ? this.refText2Info(info.text)?.title : undefined);
    if (titleCandidate && titleCandidate.trim().length > 6) {
      const cleanTitle = CitationVerifier.cleanTitle(titleCandidate).slice(0, 60);
      s.addCondition("title", "contains", cleanTitle);
      const literalTitle=titleCandidate.trim().slice(0,60);
      if(literalTitle.toLowerCase()!==cleanTitle)s.addCondition("title","contains",literalTitle);
      hasCondition = true;
    }
    if (info.identifiers?.arXiv) {
      s.addCondition("url", "contains", info.identifiers.arXiv);
      hasCondition = true;
    }
    if (info.identifiers?.CNKI) {
      s.addCondition("url", "contains", info.identifiers.CNKI);
      hasCondition = true;
    }

    if (!hasCondition) {
      return undefined;
    }

    var ids = await s.search();
    let items = (await (Zotero as any).Items.getAsync(ids)).filter((i: any) => {
      return Boolean(i && !i.deleted && (i.isRegularItem ? i.isRegularItem() : !i.isAttachment?.() && !i.isNote?.()));
    });
    return selectLibraryMatch(info,items);
  }

  /**
   * 搜索本地，获取参考文献的本地item引用
   * @param info 
   * @param libraryID 可选文库 ID
   * @returns 
   */
  public async searchLibraryItem(info: ItemBaseInfo, libraryID?: number, fresh=false): Promise<Zotero.Item | undefined> {
    await Zotero.Promise.delay(0);
    libraryID=libraryID || this.resolveLibraryID();
    if(!libraryID)return undefined;
    // Imports query again inside their write transaction. Cache invalidation is
    // allowed to drop display hints, but must never turn an existing item into
    // a definitive miss immediately before an insert.
    if(fresh)return this.searchItem(info,libraryID);
    const fast = this.matchIndex.findFastMatch(info, libraryID);
    if (fast && !fast.deleted) {
      info._item = fast;
      return fast;
    }
    const key = `${libraryID}:${workIdentity(info)}:library-item`;
    if (this.itemCache.has(key)) {
      const cached = this.itemCache.get(key);
      this.itemCache.delete(key);this.itemCache.set(key,cached || null);
      if (cached && !cached.deleted) {
        info._item = cached;
        return cached;
      }
      return undefined;
    }

    // Share metadata-independent lookup work; an item notification invalidates
    // its generation so a pre-change miss cannot repopulate the cache.
    const generation = `${this.itemCacheGeneration}:${this.libraryGenerations.get(libraryID)||0}`;
    let flight = this.itemFlights.get(key);
    if (!flight) {
      flight = this.searchItem(info, libraryID);
      this.itemFlights.set(key, flight);
    }
    let item: Zotero.Item | undefined;
    try { item = await flight; }
    finally { if (this.itemFlights.get(key) === flight) this.itemFlights.delete(key); }
    if (generation !== `${this.itemCacheGeneration}:${this.libraryGenerations.get(libraryID)||0}`) return undefined;

    // 2. 如果找到了匹配条目，进行标题验证，防止张冠李戴
    if (item) {
      const itemTitle = (item.getField("title") as string) || "";
      const searchTitle = info.title || info.text || "";
      const requestedDOI=CitationVerifier.normalizeDOI(info.identifiers?.DOI);
      const candidateDOI=CitationVerifier.normalizeDOI(item.getField("DOI") as string);
      if(requestedDOI && candidateDOI && requestedDOI!==candidateDOI) item=undefined;
      // 若无 DOI 则进行 Token 校验
      if (item && (!requestedDOI || candidateDOI!==requestedDOI) && searchTitle) {
        const sim = CitationVerifier.tokenJaccard(searchTitle, itemTitle);
        if (sim < (requestedDOI?0.85:0.65)) {
          // 相似度过低，拒绝误认
          item = undefined;
        }
      }
    }

    if (item) {
      info._item = item;
      this.matchIndex.recordMatch(item, libraryID);
    }

    // 写入 LRU 缓存（包括未找到结果的 null，避免重复查询）
    if (this.itemCache.size >= this.MAX_ITEM_CACHE) {
      const oldest = this.itemCache.keys().next().value;
      if (oldest !== undefined) this.itemCache.delete(oldest);
    }
    this.itemCache.set(key, item || null);

    return item || undefined;
  }


  public selectItemInLibrary(item: Zotero.Item, win: Window = window) {
    (win as any).Zotero_Tabs.select('zotero-pane');
    return (win as any).ZoteroPane.selectItem(item.id);
  }

  /** Snapshot only collections in the operation's owning window and library. */
  public importCollections(parent: Zotero.Item, win: Window): number[] {
    const selected=(win as any).ZoteroPane?.getSelectedCollections?.() || [];
    const ids=selected.filter((col:any)=>col&&!col.deleted&&col.libraryID===parent.libraryID)
      .map((col:any)=>Number(col.id)).filter((id:number)=>Number.isSafeInteger(id)&&id>0);
    return [...new Set<number>(ids.length?ids:parent.getCollections())];
  }

  public getItemType(item: Zotero.Item): string | undefined {
    if (!item) { return undefined; }
    if (typeof (item as any).itemType === "string") {
      return (item as any).itemType;
    }
    const typeId = (item as any).itemTypeID ?? (typeof (item as any).getType === "function" ? (item as any).getType() : undefined);
    return typeId !== undefined ? Zotero.ItemTypes.getName(Number(typeId)) : undefined;
  }

  public isChinese(text: string): boolean {
    return ReferenceParser.isChinese(text);
  }

  public isDOI(text: string): boolean {
    return ReferenceParser.isDOI(text);
  }

  public matchArXiv(text: string) {
    return ReferenceParser.matchArXiv(text);
  }

  public Html2Text(html: string): string {
    return ReferenceParser.Html2Text(html);
  }

  public getReader(win: Window = window) {
    const tabID=(win as any).Zotero_Tabs?.selectedID;
    return tabID?Zotero.Reader.getByTabID(tabID):undefined;
  }

  public resolveLibraryID(win: Window = window): number | undefined {
    try {
      const pane=(win as any).ZoteroPane;
      const ids = pane?.getSelectedLibraryIDs();
      if (Array.isArray(ids) && ids.length === 1 && Number.isFinite(Number(ids[0]))) {
        return Number(ids[0]);
      }
      const selectedItems = pane?.getSelectedItems() || [];
      const itemLibraryIDs = [...new Set(selectedItems.map((item: Zotero.Item) => Number(item.libraryID)).filter(Number.isFinite))];
      if (itemLibraryIDs.length === 1) return Number(itemLibraryIDs[0]);
      const activeItem = this.getItem(win);
      if (activeItem?.libraryID && Number.isFinite(Number(activeItem.libraryID))) {
        return Number(activeItem.libraryID);
      }
    } catch (error) {
      ztoolkit.log("Could not resolve the selected Zotero library:", error);
    }
    return undefined;
  }

  public copyText = (text: string, show: boolean = true) => {
    (new ztoolkit.Clipboard()).addText(text, "text/unicode").copy();
    if (show) {
      (new ztoolkit.ProgressWindow("Copy"))
        .createLine({ text: text, type: "success" })
        .show()
    }
  }

  public getItem(win: Window = window): Zotero.Item | undefined {
    let reader = this.getReader(win);
    if (reader?.itemID) {
      const item=Zotero.Items.get(reader.itemID);
      return item?(item.parentItem || item):undefined;
    }
    try {
      const selected = (win as any).ZoteroPane?.getSelectedItems();
      if (selected && selected.length > 0 && selected[0]?.isRegularItem?.()) {
        return selected[0];
      }
    } catch {}
  }

  public abs(v: number) {
    return v > 0 ? v : -v
  }
}

export default Utils
