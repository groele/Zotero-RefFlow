import API from "./api"
import PDF from "./pdf";
import GBT7714Parser from "./parsers/gbt7714";
import CitationVerifier from "./verifier";

class Utils {
  API: API;
  PDF: PDF;
  private lock?: _ZoteroTypes.PromiseObject;
  private itemCache: Map<string, Zotero.Item | null> = new Map();
  private readonly MAX_ITEM_CACHE: number = 800;

  public clearLibraryItemCache(): void {
    this.itemCache.clear();
  }
  public regex = {
    DOI: /10\.\d{4,9}\/[-._;()/:A-Za-z0-9><]+[^\.\]]/,
    arXiv: /(?:arXiv[\.:\s]|arxiv\.org\/abs\/)(\d{4}\.\d{4,5}(?:v\d+)?|[a-z\-]+(?:\.[A-Z]{2})?\/\d{7})/i,
    URL: /https?:\/\/[^\s<>"'{}|\\^`]+/i
  }
  constructor() {
    this.API = new API(this);
    this.PDF = new PDF(this);
  }

  public getIdentifiers(text: string): ItemBaseInfo["identifiers"] {
    const identifiers: ItemBaseInfo["identifiers"] = {};
    if (!text) return identifiers;

    // 1. DOI 探测与归一化
    const noSpaceText = text.replace(/\s+/g, "");
    const doiMatch = noSpaceText.match(/10\.\d{4,9}\/[-._;()/:A-Za-z0-9><]+/);
    if (doiMatch) {
      const clean = CitationVerifier.normalizeDOI(doiMatch[0]);
      if (clean && !/(cnki|issn)/i.test(clean)) {
        identifiers.DOI = clean;
      }
    }

    // 2. arXiv 探测 (支持新版、5位号、版本号以及旧版编号)
    const arxivMatch = text.match(/(?:arXiv[\.:\s]|arxiv\.org\/abs\/)(\d{4}\.\d{4,5}(?:v\d+)?|[a-z\-]+(?:\.[A-Z]{2})?\/\d{7})/i);
    if (arxivMatch) {
      identifiers.arXiv = arxivMatch[1];
    }

    return identifiers;
  }

  private extractURL(text: string): string | undefined {
    let res = text.match(this.regex.URL);
    if (res) {
      return res[0].replace(/[.,;:()\[\]]+$/, "");
    }
  }

  public parseRefText(text: string): { year?: string, authors?: string[], title: string, publicationVenue?: String } {
    try {
      text = text.replace(/^\[\d+?\]/, "")
      text = text.replace(/\s+/g, " ")
      // 匹配标题 (支持中文双引号 “”、书名号 《》、以及英文直引号 "")
      let title: string = "";
      let titleMatch: string = "";
      const quoteMatch = text.match(/[\u201c"《]([^\u201d"》]+)[\u201d"》]/);
      if (quoteMatch) {
        titleMatch = quoteMatch[0];
        title = quoteMatch[1].trim();
        if (title.endsWith(",")) {
          title = title.slice(0, -1);
        }
      } else {
        const segments = ((text.indexOf(". ") != -1 && text.match(/\.\s/g)!.length >= 2) && text.split(". ") || text.split("."))
          .map(s => s.trim())
          .filter(s => s.length > 0);

        if (segments.length >= 2) {
          title = titleMatch = segments
            .sort((a, b) => b.length - a.length)
            .map((s: string) => {
              let count = 0;
              [/[A-Z]\./g, /[,\.\-\(\)\:]/g, /\d/g].forEach(regex => {
                let res = s.match(regex);
                count += (res ? res.length : 0);
              });
              return [count / s.length, s] as [number, string];
            })
            .filter((s: [number, string]) => ((s[1].match(/\s+/g)?.length ?? 0) >= 2))
            .sort((a: [number, string], b: [number, string]) => a[0] - b[0])?.[0]?.[1] || segments[0];
        } else {
          title = titleMatch = segments[0] || text;
        }

        if (/\[[A-Z]\]$/.test(title)) {
          title = title.replace(/\[[A-Z]\]$/, "");
        }
      }
      title = title.trim();

      let splitByTitle = text.split(titleMatch);
      let authorInfo = splitByTitle[0]?.trim() || "";

      let publicationVenue: string | undefined = undefined;
      if (splitByTitle[1]) {
        const venueMatch = splitByTitle[1].match(/[^.\s].+[^\.]/);
        if (venueMatch) {
          publicationVenue = venueMatch[0].split(/[,\d]/)[0].trim();
        }
      }

      if (authorInfo.indexOf("et al.") != -1) {
        authorInfo = authorInfo.split("et al.")[0] + "et al.";
      }
      const currentYear = new Date().getFullYear();
      let res = text.match(/[^\d]\d{4}[^\d-]/g)?.map(s => s.match(/\d+/)![0]);
      let year = res?.find(s => {
        return Number(s) <= Number(currentYear) + 1;
      });

      if (year) {
        authorInfo = authorInfo.replace(`${year}.`, "").replace(year, "").trim();
      }

      return {
        year,
        title: title || text,
        authors: authorInfo ? [authorInfo] : [],
        publicationVenue
      };
    } catch {
      return {
        title: text
      };
    }
  }

  public _parseRefText(text: string): { year: string, authors: string[], title: string } {
    // 匹配年份
    let year
    let _years = text.match(/[^\d]?(\d{4})[^\d]?/g) as string[]
    if (_years) {
      let years = _years
        .map(year => Number(year.match(/\d{4}/)![0]))
        .filter(year => year > 1900 && year < (new Date()).getFullYear())
      if (years.length > 0) { year = String(years[0]) }
    }
    year = year as string
    if (this.isChinese(text)) {
      // extract author and title
      // [1] 张 宁, 张 雨青, 吴 坎坎. 信任的心理和神经生理机制. 2011, 1137-1143.
      // [1] 中央环保督察视角下的城市群高质量发展研究——以成渝城市群为例[J].李毅.  环境生态学.2022(04) 
      let parts = text
        .replace(/\[.+?\]/g, "")
        .replace(/\s+/g, " ")
        .split(/[\.,\uff0c\uff0e\uff3b\[\]]/) // \uff0c: ，\uff0e: ．
        .map(e => e.trim())
        .filter(e => e)
      let authors = []
      let titles = []
      for (let part of parts) {
        if (part.length <= 3 && part.length >= 2) {
          authors.push(part);
        } else {
          titles.push(part);
        }
      }
      let title = titles.sort((a, b) => b.length - a.length)[0]
      // ztoolkit.log(text, "\n->\n", title, authors)
      return { title, authors, year }
    } else {
      let authors: string[] = []
      text = text.replace(/[\u4e00-\u9fa5]/g, "")
      const authorRegexs = [/[A-Za-z,\.\s]+?\.?[\.,;]/g, /[A-Z][a-z]+ et al.,/]
      authorRegexs.forEach(regex => {
        text.match(regex)?.forEach(author => {
          authors.push(author.slice(0, -1))
        })
      })
      let title = text
        .split(/[,\.]\s/g)
        .filter((e: string) => !e.includes("http"))
        .sort((a, b) => b.length - a.length)[0]
      return { title, authors, year }
    }
  }

  public identifiers2URL(identifiers: ItemBaseInfo["identifiers"]) {
    let url
    if (identifiers.DOI) {
      url = `https://doi.org/${identifiers.DOI}`
    }
    if (identifiers.arXiv) {
      url = `https://arxiv.org/abs/${identifiers.arXiv}`
    }
    return url
  }

  public refText2Info(text: string): ItemBaseInfo {
    let identifiers = this.getIdentifiers(text);

    // 优先采用国标 GB/T 7714 确定性解析
    if (GBT7714Parser.isGBT7714(text)) {
      const gbt = GBT7714Parser.parse(text);
      if (gbt) {
        if (gbt.doi) identifiers.DOI = CitationVerifier.normalizeDOI(gbt.doi);
        return {
          identifiers: identifiers,
          url: this.extractURL(text) || this.identifiers2URL(identifiers),
          authors: gbt.authors,
          title: gbt.title,
          year: gbt.year,
          type: gbt.type as any,
          publicationVenue: gbt.source,
          text: text
        };
      }
    }

    return {
      identifiers: identifiers,
      url: this.extractURL(text) || this.identifiers2URL(identifiers),
      authors: [],
      ...this.parseRefText(text),
      type: (identifiers.arXiv ? "preprint" : "journalArticle")
    };
  }

  public parseCNKIURL(cnkiURL: string) {
    try {
      let fileName = cnkiURL.match(/fileName=(\w+)/i)![1]
      let dbName = cnkiURL.match(/dbName=(\w+)/i)![1]
      let dbCode = cnkiURL.match(/dbCode=(\w+)/i)![1]
      return { fileName, dbName, dbCode }
    } catch {}
  }

  /**
   * 将作者名称字符串拆分为符合 Zotero 规范的 firstName / lastName
   */
  public splitCreator(authorStr: string): any {
    const trimmed = authorStr.trim();
    if (!trimmed) return { creatorType: "author", name: "Unknown" };

    if (trimmed.includes(",")) {
      const parts = trimmed.split(",");
      const lastName = parts[0].trim();
      const firstName = parts.slice(1).join(",").trim();
      return { creatorType: "author", lastName, firstName: firstName || undefined };
    }

    const parts = trimmed.split(/\s+/);
    if (parts.length > 1) {
      const lastName = parts[parts.length - 1];
      const firstName = parts.slice(0, parts.length - 1).join(" ");
      return { creatorType: "author", lastName, firstName };
    }

    return { creatorType: "author", lastName: trimmed };
  }

  async createItemByZotero(identifiers: ItemBaseInfo["identifiers"], collections: number[], fallbackInfo?: ItemBaseInfo): Promise<Zotero.Item | undefined> {
    let createdItem: Zotero.Item | undefined;
    let libraryID = this.getSelectedLibraryID();

    if (identifiers?.DOI || identifiers?.arXiv) {
      try {
        var translate = new (Zotero as any).Translate.Search();
        translate.setIdentifier(identifiers);
        let translators = await translate.getTranslators();
        if (translators && translators.length > 0) {
          translate.setTranslator(translators);
          const results = await translate.translate({
            libraryID,
            collections,
            saveAttachments: false
          });
          if (results && results.length > 0) {
            createdItem = results[0];
          }
        }
      } catch (e) {
        ztoolkit.log("createItemByZotero translator failed, trying metadata fallback:", e);
      }
    }

    // 降级：如果 Translator 解析失败，但存在可用元数据，直接从元数据创建条目
    if (!createdItem && fallbackInfo) {
      try {
        const itemType = fallbackInfo.type || "journalArticle";
        const newItem: any = new (Zotero as any).Item(itemType);
        newItem.setField("title", fallbackInfo.title || fallbackInfo.text || "Untitled");
        if (identifiers?.DOI) newItem.setField("DOI", identifiers.DOI);
        if (fallbackInfo.year) newItem.setField("date", String(fallbackInfo.year));
        if (fallbackInfo.publicationVenue) newItem.setField("publicationTitle", fallbackInfo.publicationVenue);
        if (fallbackInfo.authors && fallbackInfo.authors.length > 0) {
          newItem.setCreators(fallbackInfo.authors.map(a => this.splitCreator(a)));
        }
        newItem.libraryID = libraryID;
        for (const colId of (collections || [])) {
          newItem.addToCollection(colId);
        }
        await newItem.saveTx();
        createdItem = newItem as Zotero.Item;
      } catch (err) {
        ztoolkit.log("Metadata fallback creation failed:", err);
      }
    }

    return createdItem;
  }

  async createItemByJasminum(title: string) {
    let cnkiURL = await this.API.getCNKIURL(title, true)
    ztoolkit.log("cnkiURL", cnkiURL)
    // Jasminum
    let articleId = Zotero.Jasminum.Scrape.getIDFromURL(cnkiURL);
    let postData = Zotero.Jasminum.Scrape.createRefPostData([articleId])
    let data = await Zotero.Jasminum.Scrape.getRefText(postData)

    let items = await Zotero.Jasminum.Utils.trans2Items(data, 1);
    if (items) {
      let item = items[0]
      item.setField("url", cnkiURL)
      await item.saveTx()
      return item
    }
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
    s.libraryID = libraryID || this.getSelectedLibraryID();
    // @ts-ignore
    s.addCondition("joinMode", "any");

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
      return Boolean(i && (i.isRegularItem ? i.isRegularItem() : !i.isAttachment?.() && !i.isNote?.()));
    });
    if (items.length) {
      // 1. 优先根据精准规范化 DOI 匹配
      if (info.identifiers?.DOI) {
        const cleanDOI = CitationVerifier.normalizeDOI(info.identifiers.DOI);
        const exact = items.find((it: any) => {
          try {
            const itDOI = CitationVerifier.normalizeDOI(it.getField("DOI") as string);
            return itDOI && itDOI === cleanDOI;
          } catch {
            return false;
          }
        });
        if (exact) return exact;
      }
      // 2. 存在标题时，对候选结果进行相似度打分重排，杜绝粗糙选取首项
      const searchTitle = info.title || info.text || "";
      if (searchTitle) {
        let bestItem = items[0];
        let bestSim = 0;
        for (const it of items) {
          try {
            const itTitle = (it.getField("title") as string) || "";
            const sim = CitationVerifier.tokenJaccard(searchTitle, itTitle);
            if (sim > bestSim) {
              bestSim = sim;
              bestItem = it;
            }
          } catch {}
        }
        return bestItem;
      }
      return items[0];
    }
  }

  /**
   * 搜索本地，获取参考文献的本地item引用
   * @param info 
   * @param libraryID 可选文库 ID
   * @returns 
   */
  public async searchLibraryItem(info: ItemBaseInfo, libraryID?: number): Promise<Zotero.Item | undefined> {
    await Zotero.Promise.delay(0);
    const key = `${libraryID || 1}:${info.identifiers?.DOI || ""}:${info.identifiers?.arXiv || ""}:${info.title || info.text || ""}:library-item`;
    if (this.itemCache.has(key)) {
      const cached = this.itemCache.get(key);
      if (cached) {
        info._item = cached;
        return cached;
      }
      return undefined;
    }

    // 1. 优先使用精确的 Zotero.Search 引擎
    let item = await this.searchItem(info, libraryID);

    // 2. 如果找到了匹配条目，进行标题验证，防止张冠李戴
    if (item) {
      const itemTitle = (item.getField("title") as string) || "";
      const searchTitle = info.title || info.text || "";
      // 若无 DOI 则进行 Token 校验
      if (!info.identifiers?.DOI && searchTitle) {
        const sim = CitationVerifier.tokenJaccard(searchTitle, itemTitle);
        if (sim < 0.65) {
          // 相似度过低，拒绝误认
          item = undefined;
        }
      }
    }

    if (item) {
      info._item = item;
      info.title = item.getField("title") as string;
      const DOI = item.getField("DOI") as string;
      if (DOI) {
        info.identifiers = info.identifiers || {};
        info.identifiers.DOI = DOI;
      }
    }

    // 写入 LRU 缓存（包括未找到结果的 null，避免重复查询）
    if (this.itemCache.size >= this.MAX_ITEM_CACHE) {
      const oldest = this.itemCache.keys().next().value;
      if (oldest !== undefined) this.itemCache.delete(oldest);
    }
    this.itemCache.set(key, item || null);

    return item || undefined;
  }


  public selectItemInLibrary(item: Zotero.Item) {
    Zotero_Tabs.select('zotero-pane');
    ZoteroPane.selectItem(item.id);
  }

  public getItemType(item: Zotero.Item): string | undefined {
    if (!item) { return undefined; }
    if (typeof (item as any).itemType === "string") {
      return (item as any).itemType;
    }
    const typeId = (item as any).itemTypeID ?? (typeof (item as any).getType === "function" ? (item as any).getType() : undefined);
    return typeId !== undefined ? Zotero.ItemTypes.getName(Number(typeId)) : undefined;
  }

  public isChinese(text: string) {
    text = text.replace(/\s+/g, "")
    return (text.match(/[\u4E00-\u9FA5]/g)?.length || 0) / text.length > .5
  }

  public isDOI(text: string): boolean {
    if (!text) { return false; }
    const clean = CitationVerifier.normalizeDOI(text);
    return Boolean(clean && !/(cnki|issn)/i.test(clean));
  }

  public matchArXiv(text: string) {
    let res = text.match(this.regex.arXiv)
    if (res != null && res.length >= 2) {
      return res[1]
    } else {
      return false
    }
  }

  public Html2Text(html: string): string {
    if (!html) { return ""; }
    let text = "";
    try {
      let span: HTMLSpanElement | null = document.createElement("span")
      span.innerHTML = html
      text = span.innerText || span.textContent || ""
      span = null
    } catch (e) {
      text = ""
    }
    if (!text) {
      text = html
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'");
    }
    return text.replace(/\n+/g, " ").trim();
  }

  public getReader() {
    return Zotero.Reader.getByTabID(Zotero_Tabs.selectedID)
  }

  public getSelectedLibraryID(): number {
    try {
      const ids = (ZoteroPane as any)?.getSelectedLibraryIDs?.();
      if (Array.isArray(ids) && ids.length === 1 && Number.isFinite(Number(ids[0]))) {
        return Number(ids[0]);
      }
      const selectedItems = (ZoteroPane as any)?.itemsView?.getSelectedItems?.() || [];
      const itemLibraryIDs = [...new Set(selectedItems.map((item: Zotero.Item) => Number(item.libraryID)).filter(Number.isFinite))];
      if (itemLibraryIDs.length === 1) return Number(itemLibraryIDs[0]);
    } catch (error) {
      ztoolkit.log("Could not resolve the selected Zotero library:", error);
    }
    return 1;
  }

  public copyText = (text: string, show: boolean = true) => {
    (new ztoolkit.Clipboard()).addText(text, "text/unicode").copy();
    if (show) {
      (new ztoolkit.ProgressWindow("Copy"))
        .createLine({ text: text, type: "success" })
        .show()
    }
  }

  public getItem(): Zotero.Item | undefined {
    let reader = this.getReader();
    if (reader) {
      return reader._item?.parentItem || reader._item;
    }
    try {
      const selected = (ZoteroPane as any)?.itemsView?.getSelectedItems?.() || (ZoteroPane as any)?.getSelectedItems?.();
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
