import { config } from "../../package.json";
import { initLocale, getString } from "../utils/locale";
import TipUI from "./tip";
import Utils from "./utils";
import LocalStorge from "./localStorage";
import BatchImporter from "./batchImporter";
import ReferenceCards from "./referenceCards";
import ReferenceTasks, { ReferenceTaskContext } from "./referenceTasks";
import { cacheReferences, readCachedReferences } from "./referenceCache";
import { retrieveReferenceList, ReferenceProvider, ReferenceResult } from "./referenceRetrieval";
import CitationVerifier from "./verifier";


export default class Views {
  public utils!: Utils;
  public readonly referenceTasks = new ReferenceTasks();
  public readonly storage = new LocalStorge(config.addonRef);
  private paneID?: string;
  private notifierID?: string;
  private disposed = false;
  constructor() {
    initLocale();
    (document as any).l10n?.addResourceIds([`${config.addonRef}-addon.ftl`]);
    this.utils = new Utils()
    this.addStyle()
  }

  private addStyle(doc: Document = document) {
    const styles = ztoolkit.UI.createElement(doc, "style", {
      id: `${config.addonRef}-style`,
      properties: {
        innerHTML: `
          .refnexus-card-search {box-sizing:border-box;width:100%;margin:4px 0 6px;padding:5px 8px;border:1px solid var(--material-border,#ccc);border-radius:4px;background:var(--material-background,#fff);color:inherit;}
          .refnexus-status {font-size:.85em;opacity:.75;border:0!important;padding:0!important;min-height:18px;}
          .reference-item {display:flex;gap:6px;align-items:flex-start;padding:6px 4px;border-radius:4px;cursor:default;min-width:0;}
          .reference-item[hidden] {display:none!important;}
          .reference-item:hover {background:var(--material-mix-quinary,rgba(128,128,128,.08));}
          .reference-item.selected {background:var(--color-accent-10,rgba(60,120,200,.16));}
          .reference-item:focus-visible {outline:1px solid var(--color-accent,#3678b5);}
          .reference-state {width:9px;height:9px;border-radius:50%;flex:none;margin-top:5px;}
          .reference-description {display:flex;flex-direction:column;gap:3px;min-width:0;flex:1;overflow-wrap:anywhere;}
          .reference-text {font-size:.9em;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;}
          .reference-title {font-size:1em;line-height:1.35;}
          .reference-about {font-size:.85em;opacity:.6;}
          .reference-retracted {color:var(--color-red,#b42318);}
          .reference-action {border:0;background:transparent;color:inherit;border-radius:50%;width:22px;height:22px;flex:none;cursor:pointer;font-size:18px;}
          .reference-action:hover {background:var(--material-mix-quaternary,rgba(128,128,128,.15));}
          .reference-search-box .icon {
            display: flex;
            justify-content: center;
            align-items: center;
            opacity: 0.8;
          }
          .reference-search-box .icon:hover {
            opacity: 1;
          }
          .zotero-editpane-related .header {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 4px 6px;
            border-bottom: 1px solid var(--material-border, #e0e0e0);
          }
          .zotero-editpane-related .header label#reference-num {
            flex-grow: 1;
            font-weight: 500;
          }
          .zotero-editpane-related .header button {
            padding: 2px 8px;
            font-size: 12px;
            cursor: pointer;
            border-radius: 4px;
            border: 1px solid var(--material-border, #ccc);
            background: var(--material-button-background, #f5f5f5);
          }
          .zotero-editpane-related .header button:hover {
            background: var(--material-button-background-hover, #e8e8e8);
          }
        `
      },
    });
    doc.documentElement.appendChild(styles);
  }
  /**
   * 注册阅读侧边栏
   */
  public async onInit() {
    this.registerReferenceItemPane();
    this.notifierID = Zotero.Notifier.registerObserver({ notify: () => this.utils.clearLibraryItemCache() }, ["item"], config.addonRef);
  }

  /** Register the reference list as a native Zotero 10 item-pane section. */
  private registerReferenceItemPane() {
    const paneManager = Zotero.ItemPaneManager;
    if (!paneManager?.registerSection) {
      ztoolkit.log("Zotero 10 ItemPaneManager is unavailable; reference sidebar section was not registered");
      return;
    }

    const icon = `chrome://${config.addonRef}/content/icons/reference-sidenav.svg`;
    const paneID = `${config.addonRef}-references`;
    const registered = paneManager.registerSection({
      paneID,
      pluginID: config.addonID,
      sidenav: { l10nID: "refnexus-pane-title", icon },
      header: { l10nID: "refnexus-pane-title",l10nArgs:JSON.stringify({count:0}), icon: `chrome://${config.addonRef}/content/icons/reference.svg` },
      sectionButtons:[
        {type:"type",icon:`chrome://${config.addonRef}/content/icons/type.svg`,l10nID:"refnexus-pane-type",onClick:({body,item})=>this.typeMenu(body,item)},
        {type:"refresh",icon:`chrome://${config.addonRef}/content/icons/refresh.svg`,l10nID:"refnexus-pane-refresh",onClick:({body,item})=>this.refreshReferences(body as any,false,false,false,item?.parentItem||item)},
        {type:"more",icon:`chrome://${config.addonRef}/content/icons/more.svg`,l10nID:"refnexus-pane-more",onClick:({body})=>(body as any)._cards?.menu()}
      ],
      onRender: ({ body, item, setL10nArgs }) => {
        (body.ownerDocument as any).l10n?.addResourceIds([`${config.addonRef}-addon.ftl`]);
        if(!body.ownerDocument.getElementById(`${config.addonRef}-style`))this.addStyle(body.ownerDocument);
        const identity=String(item?.parentItem?.id || item?.id || "");
        if((body as any)._cards && body.getAttribute("data-refnexus-item-id")===identity && body.querySelector(".refnexus-card-search")) {
          (body as any)._setL10nArgs=setL10nArgs;
          setL10nArgs(JSON.stringify({count:(body as any).references?.length||0}));
          return;
        }
        this.referenceTasks.invalidate(body);
        body.replaceChildren();
        (body as any).references = [];
        body.setAttribute("data-refnexus-type",String(Zotero.Prefs.get(`${config.addonRef}.type`)||"References"));
        body.classList.add("zotero-editpane-related");
        body.setAttribute("data-refnexus-item-id", String(item?.parentItem?.id || item?.id || ""));
        body.setAttribute("source", (Zotero.Prefs.get(`${config.addonRef}.prioritySource`) as string) || "PDF");

        const controls = body.ownerDocument.createElement("div");
        controls.className = "header";
        const count = body.ownerDocument.createElement("label");
        count.id = "reference-num";
        count.setAttribute("role", "status");
        count.setAttribute("aria-live", "polite");
        count.textContent = `0 ${getString("relatedbox-number-label")}`;
        count.title = getString("relatedbox-copy-all-tooltip") || "Double-click to copy the reference list";
        count.addEventListener("dblclick", () => this.utils.copyText(((body as any).references || []).map((ref: ItemBaseInfo) => ref.text || ref.title || "").join("\n"), false));
        const source = body.ownerDocument.createElement("select");
        source.setAttribute("aria-label", getString("relatedbox-source-label") || "Reference source");
        for (const [value, label] of [["Auto", getString("cards-source-auto")], ["PDF", "PDF"], ["Web", getString("cards-source-web")], ["API", "Online"]]) {
          const option = body.ownerDocument.createElement("option");
          option.value = value;
          option.textContent = label;
          source.append(option);
        }
        source.value = body.getAttribute("source") || "PDF";
        source.addEventListener("change", () => {
          this.resetReferencePane(body);
          body.setAttribute("data-refnexus-type", "References");
          Zotero.Prefs.set(`${config.addonRef}.type`, "References");
          body.setAttribute("source", source.value);
          Zotero.Prefs.set(`${config.addonRef}.prioritySource`, source.value);
          void this.refreshReferences(body as any, true);
        });

        const refresh = body.ownerDocument.createElement("button");
        refresh.type = "button";
        refresh.id = "refresh-button";
        refresh.textContent = getString("relatedbox-fetch-label") || "获取参考文献";
        refresh.addEventListener("click", async () => {
          const currentItem = Zotero.Items.get(Number(body.getAttribute("data-refnexus-item-id"))) as Zotero.Item | undefined;
          if (!currentItem || !currentItem.isRegularItem()) {
            count.textContent = getString("relatedbox-select-item") || "请先选择一篇文献";
            return;
          }
          try {
            await this.refreshReferences(body as any, true, false, false, currentItem);
          } catch (error) {
            ztoolkit.log("Item pane reference fetch failed:", error);
            count.textContent = getString("relatedbox-fetch-error") || "获取失败，请重试";
          } finally { if (!body.hasAttribute("aria-busy")) refresh.disabled = false; }
        });
        const force = body.ownerDocument.createElement("button");
        force.type = "button"; force.id = "refnexus-force-refresh";
        force.textContent = getString("relatedbox-force-label");
        force.addEventListener("click", () => this.refreshReferences(body as any, false).catch(error => ztoolkit.log(error)));
        const cancel = body.ownerDocument.createElement("button");
        cancel.type = "button"; cancel.id = "refnexus-cancel"; cancel.hidden = true;
        cancel.textContent = getString("relatedbox-cancel-label");
        cancel.addEventListener("click", () => { this.resetReferencePane(body); count.textContent=getString("relatedbox-cancelled"); });
        controls.style.flexWrap = "wrap";
        controls.style.gap = "6px";
        controls.classList.add("refnexus-status");
        // The original XPI keeps operations in the collapsible-section header.
        source.hidden=true;refresh.hidden=true;force.hidden=true;
        controls.append(count, source, refresh, force, cancel);
        const search=body.ownerDocument.createElement("input");search.type="search";search.className="refnexus-card-search";
        search.placeholder=getString("relatedbox-search-placeholder");search.setAttribute("aria-label",search.placeholder);

        const grid = body.ownerDocument.createElement("div");
        grid.id = "related-grid";
        grid.className = "grid";
        grid.style.overflowY = "auto";
        grid.style.display="flex";grid.style.flexDirection="column";
        body.append(search,controls,grid);
        (body as any)._cards?.dispose();
        (body as any)._cards=new ReferenceCards(this,body,grid,search);
        (body as any)._setL10nArgs=setL10nArgs;
        setL10nArgs(JSON.stringify({count:0}));
      },
      onAsyncRender: async ({ body, item }) => {
        const parent = item?.parentItem || item;
        if (!parent?.isRegularItem()) return;
        const excluded = String(Zotero.Prefs.get(`${config.addonRef}.notAutoRefreshItemTypes`) || "").split(",").map(value => value.trim());
        if (Zotero.Prefs.get(`${config.addonRef}.autoRefresh`) && !excluded.includes(Zotero.ItemTypes.getName(parent.itemTypeID))) {
          await this.refreshReferences(body as any, true, false, false, parent);
        }
      },
      onItemChange: ({ body, item }) => {
        const identity=String(item?.parentItem?.id || item?.id || "");
        if(body.getAttribute("data-refnexus-item-id")===identity)return;
        this.resetReferencePane(body);
        body.setAttribute("data-refnexus-item-id", String(item?.parentItem?.id || item?.id || ""));
      },
      onDestroy: ({ body }) => {this.referenceTasks.invalidate(body);(body as any)._cards?.dispose();}
    });
    if (!registered) {
      ztoolkit.log("Zotero refused to register the RefNexus item-pane section");
    }
    if (registered) this.paneID = registered;
  }

  private resetReferencePane(body: Element): void {
    this.referenceTasks.invalidate(body);
    (body as any).references=[];
    (body as any)._cards?.clear();
    (body as any)._setL10nArgs?.(JSON.stringify({count:0}));
    body.querySelector("#related-grid")?.replaceChildren();
    body.removeAttribute("aria-busy");
    const count=body.querySelector("#reference-num");
    if (count) count.textContent=`0 ${getString("relatedbox-number-label")}`;
    body.querySelectorAll("button").forEach(button=>{ (button as HTMLButtonElement).disabled=false; });
    const cancel=body.querySelector("#refnexus-cancel") as HTMLElement;
    if (cancel) cancel.hidden=true;
  }

  private typeMenu(body:HTMLElement,item?:Zotero.Item) {
    const doc:any=body.ownerDocument,popup=doc.createXULElement("menupopup");
    for(const [type,key] of [["References","cards-type-references"],["Citations","cards-type-citations"],["Related","cards-type-related"]]) {
      const entry=doc.createXULElement("menuitem");entry.setAttribute("label",getString(key));entry.setAttribute("type","radio");entry.setAttribute("checked",String(body.getAttribute("data-refnexus-type")===type));
      entry.addEventListener("command",async()=>{this.resetReferencePane(body);body.setAttribute("data-refnexus-type",type);Zotero.Prefs.set(`${config.addonRef}.type`,type);body.setAttribute("source",type==="References"?String(Zotero.Prefs.get(`${config.addonRef}.prioritySource`)||"PDF"):"API");await this.refreshReferences(body as any,true,false,false,item?.parentItem||item);});popup.append(entry);
    }
    popup.addEventListener("popuphidden",()=>popup.remove(),{once:true});doc.documentElement.append(popup);popup.openPopup(body.closest("item-pane-custom-section"),"after_end",0,0,false,false);
  }

  public async shutdown(): Promise<void> {
    this.disposed=true;
    this.referenceTasks.dispose();
    this.utils.API.requests.dispose();
    this.utils.API.publisherReferences.dispose();
    if (this.notifierID) Zotero.Notifier.unregisterObserver(this.notifierID);
    if (this.paneID) Zotero.ItemPaneManager.unregisterSection(this.paneID);
    await this.storage.flush();
    for(const win of Zotero.getMainWindows())win.document.getElementById(`${config.addonRef}-style`)?.remove();
  }

  public importReferences(parent: Zotero.Item, refs: ItemBaseInfo[], options: any) { return BatchImporter.importAll(parent,refs,options); }
  public rollbackReferences(parent: Zotero.Item, batchID: string) { return BatchImporter.rollbackBatch(parent,batchID); }

  private getPanelItem(panel: Element): Zotero.Item | undefined {
    const id=Number(panel.getAttribute("data-refnexus-item-id"));
    const item=id?Zotero.Items.get(id):this.utils.getItem();
    return item?.isAttachment()?item.parentItem:item;
  }

  private readerMatchesItem(reader: any,item: Zotero.Item): boolean {
    const attachment=reader?._item || (reader?.itemID?Zotero.Items.get(reader.itemID):undefined);
    return Boolean(attachment?.attachmentContentType==="application/pdf" && (attachment.parentID===item.id || attachment.id===item.id));
  }

  private async pdfAttachment(item: Zotero.Item,reader?: any): Promise<Zotero.Item | undefined> {
    if(this.readerMatchesItem(reader,item))return reader._item || Zotero.Items.get(reader.itemID);
    const best=await item.getBestAttachment();
    const attachments=await (Zotero.Items as any).getAsync(item.getAttachments()) as Zotero.Item[];
    const candidates=[best,...attachments].filter((candidate,index,list)=>candidate&&list.indexOf(candidate)===index) as Zotero.Item[];
    const supplementary=(candidate:Zotero.Item)=>/\bsupplement(?:ary|al)?\b|\bsupporting\s+information\b|\badditional\s+file\b|\b(?:ESI|SI)\b|补充|附件/i.test(String(candidate.getField("title"))+" "+String(candidate.getField("url")));
    candidates.sort((a,b)=>Number(supplementary(a))-Number(supplementary(b)));
    for(const candidate of candidates) {
      if(!candidate || candidate.attachmentContentType!=="application/pdf" || candidate.deleted)continue;
      const path=await candidate.getFilePathAsync();
      if(path && Zotero.File.pathToFile(path).exists())return candidate;
    }
    return undefined;
  }

  private async pdfCacheSignature(item: Zotero.Item,reader?: any): Promise<string> {
    const attachment=await this.pdfAttachment(item,reader);
    if (!attachment || attachment.attachmentContentType!=="application/pdf") return "";
    const path=await attachment.getFilePathAsync();
    if (!path) return "";
    const file=Zotero.File.pathToFile(path);
    if (!file.exists()) return "";
    return `pdf-layout-v4:${attachment.libraryID}:${attachment.key}:${file.fileSize}:${file.lastModifiedTime}`;
  }

  private async getReaderForItem(item: Zotero.Item,signal?: AbortSignal): Promise<_ZoteroTypes.ReaderInstance | undefined> {
    const isSameItem = (reader?: _ZoteroTypes.ReaderInstance) => this.readerMatchesItem(reader,item);
    const active = this.utils.getReader();
    if (isSameItem(active)) return active;

    const attachment=await this.pdfAttachment(item);
    if (!attachment || signal?.aborted) return undefined;

    const opened = await Zotero.Reader.open(attachment.id, undefined, { openInBackground: true });
    if (opened && isSameItem(opened)) return opened;
    for (let attempt = 0; attempt < 50; attempt++) {
      if(signal?.aborted)return undefined;
      const readers = ((Zotero.Reader as any)._readers || []) as _ZoteroTypes.ReaderInstance[];
      const reader = readers.find(isSameItem);
      if (reader) return reader;
      await Zotero.Promise.delay(100);
    }
    return undefined;
  }

  public async refreshReferences(
    panel: XUL.TabPanel,
    local: boolean = true,
    fromCurrentPage: boolean = false,
    toggleSource: boolean = false,
    itemOverride?: Zotero.Item,
    readerOverride?: _ZoteroTypes.ReaderInstance
  ) {
    if (this.disposed || !panel?.isConnected) return;
    if (toggleSource) panel.setAttribute("source", panel.getAttribute("source")==="PDF"?"API":"PDF");
    const literatureType=panel.getAttribute("data-refnexus-type")||"References";
    const source=literatureType==="References"?(panel.getAttribute("source") || (Zotero.Prefs.get(`${config.addonRef}.prioritySource`) as string) || "PDF"):"API";
    panel.setAttribute("source",source);
    const item=itemOverride || this.getPanelItem(panel);
    const label=panel.querySelector("#reference-num");
    if (!item?.isRegularItem()) { if (label) label.textContent=getString("relatedbox-select-item"); return; }
    const key=`${item.libraryID}:${item.key}|${literatureType}|${source}|${fromCurrentPage?"page":"full"}|${local?"cache":"force"}`;
    return this.referenceTasks.run(panel,key,async context=>{
      const boundItem=panel.getAttribute("data-refnexus-item-id");
      const current=()=>context.isCurrent() && panel.isConnected && (panel.getAttribute("data-refnexus-type")||"References")===literatureType && panel.getAttribute("source")===source && panel.getAttribute("data-refnexus-item-id")===boundItem;
      panel.setAttribute("aria-busy","true");
      panel.querySelectorAll("#refresh-button, #refnexus-force-refresh").forEach(button=>(button as HTMLButtonElement).disabled=true);
      const cancel=panel.querySelector("#refnexus-cancel") as HTMLElement;
      if (cancel) cancel.hidden=false;
      try {
        await this.performReferences(panel,local,fromCurrentPage,item,readerOverride,{...context,isCurrent:current});
      } catch (error: any) {
        if (current() && label) {label.textContent=error?.name==="TimeoutError"?getString("relatedbox-timeout"):getString("relatedbox-fetch-error");(label as HTMLElement).title=String(error?.message||error);}
        if (error?.name!=="AbortError") ztoolkit.log("Reference fetch failed",error);
      } finally {
        if (current()) {
          panel.removeAttribute("aria-busy");
          panel.querySelectorAll("#refresh-button, #refnexus-force-refresh").forEach(button=>(button as HTMLButtonElement).disabled=false);
          if (cancel) cancel.hidden=true;
        }
      }
    });
  }

  private async smartReferences(item:Zotero.Item,reader:any,task:ReferenceTaskContext,includePDF:boolean,fromCurrentPage:boolean,label:HTMLElement,webFirst=false):Promise<ReferenceResult> {
    const api=this.utils.API,title=String(item.getField("title")),url=String(item.getField("url"));
    let doi=String(item.getField("DOI")||"");
    const resolveDOI=async()=>{
      if(!this.utils.isDOI(doi))doi=CitationVerifier.normalizeDOI(url)||"";
      if(!doi&&task.isCurrent())doi=(await api.resolveWork(title,(item.getCreators()[0] as any)?.lastName,String(item.getField("date"))))?.doi||"";
      return doi;
    };
    const providers:ReferenceProvider[]=[];
    if(includePDF)providers.push({name:"PDF",run:async()=>{
      reader=reader||await this.getReaderForItem(item,task.signal);
      if(!reader||!task.isCurrent())return;
      const references=await this.utils.PDF.getReferences(reader,fromCurrentPage,{signal:task.signal,notify:false,onProgress:pages=>{if(task.isCurrent())label.textContent=`${getString("relatedbox-loading")} PDF · ${pages} ${getString("relatedbox-pages-label")}`;}});
      return {references,source:"PDF"};
    }});
    providers.push({name:"Snapshot",run:async()=>{
      for(const id of item.getAttachments().slice(0,20)) {
        if(!task.isCurrent())return;
        const attachment=Zotero.Items.get(id);if(attachment?.attachmentContentType!=="text/html"||attachment.deleted)continue;
        const path=await attachment.getFilePathAsync();if(!path)continue;
        const file=Zotero.File.pathToFile(path);if(!file.exists()||file.fileSize>8*1024*1024)continue;
        const html=await Zotero.File.getContentsAsync(path);
        if(typeof html!=="string")continue;
        const references=api.publisherReferences.parseHTML(html,String(attachment.getField("url")||url),doi,title);
        if(references.length)return {references,source:references[0].sources?.[0]+" snapshot"};
      }
      return;
    }});
    if(webFirst)providers.push({name:"Publisher / JATS",run:async()=>{
      if(!await resolveDOI()||!task.isCurrent())return;
      const references=await api.publisherReferences.getReferences(doi,url,title,task.signal);
      return {references,source:references[0]?.sources?.[0]||"Publisher"};
    }});
    providers.push({name:"Online",run:async()=>{
      if(!await resolveDOI()||!task.isCurrent())return;
      return api.getReferenceList(doi,url,title,task.signal);
    }});
    return retrieveReferenceList(providers,task.signal,source=>{if(task.isCurrent())label.textContent=`${getString("relatedbox-loading")} ${source}`;});
  }

  private async snapshotSignature(item:Zotero.Item):Promise<any[]> {
    const signatures:any[]=[];
    for(const id of item.getAttachments().slice(0,20)) {
      const attachment=Zotero.Items.get(id);
      if(!attachment||attachment.deleted||attachment.attachmentContentType!=="text/html")continue;
      const path=await attachment.getFilePathAsync();
      const file=path?Zotero.File.pathToFile(path):undefined;
      signatures.push([attachment.key,attachment.dateModified,file?.exists()?file.fileSize:0,file?.exists()?file.lastModifiedTime:0]);
    }
    return signatures;
  }

  private async performReferences(panel: XUL.TabPanel, local: boolean, fromCurrentPage: boolean, item: Zotero.Item, readerOverride: _ZoteroTypes.ReaderInstance | undefined, task: ReferenceTaskContext) {
    let label = panel.querySelector("label#reference-num") as XUL.Label;
    const literatureType=panel.getAttribute("data-refnexus-type")||"References";
    const initialSource = panel.getAttribute("source") || "PDF";
    label.textContent = `${getString("relatedbox-loading")} [${initialSource}]`;
    const source=initialSource;
    let reader = readerOverride || this.utils.getReader();
    if(!this.readerMatchesItem(reader,item))reader=undefined as any;
    const signature=source==="PDF"?await this.pdfCacheSignature(item,reader):JSON.stringify(["retrieval-v1",item.getField("DOI"),item.getField("url"),item.getField("title"),item.getField("date"),item.getCreators(),source==="Auto"?await this.pdfCacheSignature(item,reader):"",["Auto","Web"].includes(source)?await this.snapshotSignature(item):[]]);
    if (!task.isCurrent()) return;

    // clear 
    panel.querySelectorAll("#related-grid *").forEach(e => e.remove());

    const gridEl = panel.querySelector("#related-grid");
    if (gridEl) {
      (gridEl as any)._seenTexts = new Set<string>();
    }

    let references: ItemBaseInfo[]=[];
    (panel as any).references=[];
    if (!local && source==="API") this.utils.API.requests.clearCache();
    if(!local&&["API","Auto","Web"].includes(source))this.utils.API.publisherReferences.clearCache();

    let resultSource=source;
    if(literatureType!=="References") {
      const key=`References-API-${literatureType}`;
      const cached=await this.storage.getAsync(item,key);
      const previous=readCachedReferences(cached,signature,cached?.snapshot?.truncated?15*60*1000:24*60*60*1000);
      const describe=(source:string,total:number,truncated:boolean)=>`${source} ${literatureType}${truncated?(Number.isFinite(total)&&total>references.length?` (${references.length}/${total})`:` (${references.length}+ · ${getString("cards-partial")})`):""}`;
      if(local && previous){references=previous;resultSource=describe(cached?.snapshot?.source||"OpenAlex",Number(cached?.snapshot?.total||references.length),Boolean(cached?.snapshot?.truncated));}
      else {
        let doi=String(item.getField("DOI")||"");
        if(!doi)doi=(await this.utils.API.resolveWork(String(item.getField("title")),(item.getCreators()[0] as any)?.lastName,String(item.getField("date"))))?.doi||"";
        if(!task.isCurrent())return;
        if(!doi)throw new Error(getString("cards-work-not-found"));
        let result:any,provider="OpenAlex";
        try {result=await this.utils.API.openAlex.getNeighborhood(doi,literatureType as any,task.signal);}
        catch(error) {
          if(!task.isCurrent())return;
          if(previous){references=previous;resultSource=describe(cached?.snapshot?.source||provider,Number(cached?.snapshot?.total||references.length),Boolean(cached?.snapshot?.truncated))+` · ${getString("cards-cached-offline")}`;label.title=String(error);}
          else if(literatureType==="Citations") {
            const fallback=await this.utils.API.getDOIRelatedArray(doi,100);
            if(!task.isCurrent())return;
            if(!fallback?.length)throw error;
            result={references:fallback,total:undefined,truncated:true};provider="Semantic Scholar";
          }else throw error;
        }
        if(!task.isCurrent())return;
        if(result){references=result.references;resultSource=describe(provider,result.total,result.truncated);
          await this.storage.set(item,key,{...cacheReferences(references,signature),snapshot:{source:provider,total:result.total,truncated:result.truncated}});
        }
      }
    } else if (source === "Auto" || source === "Web") {
      const key=`References-${source}`;
      const cached=await this.storage.getAsync(item,key);
      const previous=readCachedReferences(cached,signature,cached?.snapshot?.partial?15*60*1000:24*60*60*1000);
      let result:ReferenceResult;
      if(local&&previous)result={references:previous,...cached.snapshot};
      else {
        result=await this.smartReferences(item,reader,task,source!=="Web",fromCurrentPage,label,source==="Web");
        if(!task.isCurrent())return;
        if(!result.references.length&&previous)result={references:previous,...cached.snapshot,source:cached.snapshot.source+` · ${getString("cards-cached-offline")}`,attempts:result.attempts};
        else if(result.references.length)await this.storage.set(item,key,{...cacheReferences(result.references,signature),snapshot:{source:result.source,partial:result.partial,expected:result.expected}});
      }
      references=result.references;resultSource=result.source;
      if(result.partial)resultSource+=` (${references.length}${result.expected?"/"+result.expected:"+"} · ${getString("cards-partial")})`;
      label.title=result.attempts?.join("\n")||"";
    } else if (source == "PDF") {
      // 优先本地读取
      const key = "References-PDF";
      references = local && !fromCurrentPage && signature ? readCachedReferences(await this.storage.getAsync(item,key),signature,Number.MAX_SAFE_INTEGER) as any : undefined;
      if (!task.isCurrent()) return;
      if (references) {
        (new ztoolkit.ProgressWindow("[Local] PDF"))
          .createLine({ text: `${references.length} references`, type: "success"})
          .show();
      } else {
        if (!reader) reader=await this.getReaderForItem(item,task.signal) as any;
        if (!task.isCurrent()) return;
        if (!reader) {
          references = [];
        } else {
          try{references = await this.utils.PDF.getReferences(reader, fromCurrentPage,{signal:task.signal,notify:false,onProgress:scanned=>{if(task.isCurrent()) label.textContent=`${getString("relatedbox-loading")} PDF · ${scanned} ${getString("relatedbox-pages-label")}`;}});}
          catch(error:any){if(error?.name==="AbortError"||fromCurrentPage)throw error;references=[];ztoolkit.log("PDF failed; trying structured sources",error);}
        }
        if (!task.isCurrent()) return;
        if (references.length && signature && !fromCurrentPage && Zotero.Prefs.get(`${config.addonRef}.savePDFReferences`)) {
          await this.storage.set(item,key,cacheReferences(references,signature));
        }
      }
      // An empty/scanned/missing PDF should not require a manual source switch.
      if(!references?.length&&!fromCurrentPage){
        const result=await this.smartReferences(item,undefined,task,false,false,label);
        if(!task.isCurrent())return;
        references=result.references;resultSource=result.source;label.title=result.attempts?.join("\n")||"";
      }
    } else {
      const key = "References-API";
      references = local ? readCachedReferences(await this.storage.getAsync(item,key),signature,24*60*60*1000) as any : undefined;
      if (!task.isCurrent()) return;
      if (references) {
        (new ztoolkit.ProgressWindow("[Local] API"))
          .createLine({ text: `${references.length} references`, type: "success" })
          .show();
      } else {
        
        let DOI = item.getField("DOI") as string;
        let url = item.getField("url") as string;
        let title = item.getField("title") as string;

        let fileName = this.utils.parseCNKIURL(url)?.fileName;
        let popupWin: any;
        try {
          if (this.utils.isDOI(DOI)) {
            popupWin = new ztoolkit.ProgressWindow("[Pending] API", { closeTime: -1 });
            popupWin
              .createLine({ text: "Request DOI references...", type: "default" })
              .show();
            const result=await this.utils.API.getReferenceList(DOI,url,title,task.signal);references=result.references;resultSource=result.source;
            if(result.partial)resultSource+=` (${references.length}${result.expected?"/"+result.expected:"+"} · ${getString("cards-partial")})`;
          } else if (this.utils.isChinese(title) || fileName) {
            // 知网文献处理
            if (!fileName) {
              try {
                let url = (await this.utils.API.getCNKIURL(title)) as string;
                if (!task.isCurrent()) return;
                if (url) {
                  fileName = this.utils.parseCNKIURL(url)?.fileName;
                }
              } catch {
                (new ztoolkit.ProgressWindow("[Fail] API"))
                  .createLine({ text: `Error, Get CNKI URL`, type: "fail" })
                  .show();
                return;
              }
              if (!fileName) {
                (new ztoolkit.ProgressWindow("[Fail] API"))
                  .createLine({ text: `Fail, Get CNKI URL`, type: "fail" })
                  .show();
                return;
              }
            }
            popupWin = new ztoolkit.ProgressWindow("[Pending] API", { closeTime: -1, closeOtherProgressWindows: true });
            popupWin
              .createLine({ text: "Request CNKI references...", type: "default" })
              .show();
            references = (await this.utils.API.getCNKIFileInfo(fileName))?.references!;
            if (!references) {
              popupWin.changeHeadline("[Fail] API");
              popupWin.changeLine({ text: `Not Supported, ${fileName}`, type: "fail" });
              popupWin.startCloseTimer(3000);
              return;
            }
          } else {
            // 国际文献无 DOI：通过多源联邦解析器解析 DOI
            popupWin = new ztoolkit.ProgressWindow("[Pending] API", { closeTime: -1 });
            popupWin.createLine({ text: "Resolving Title to DOI...", type: "default" }).show();
            const firstAuthor = (item.getCreators()?.[0] as any)?.name || (item.getCreators()?.[0] as any)?.lastName;
            const date = item.getField("date") as string;
            const resolved = await this.utils.API.resolveWork(title, firstAuthor, date);
            if (!task.isCurrent()) return;
            if (resolved?.doi) {
              DOI = resolved.doi;
              popupWin.changeLine({ text: `Found DOI: ${DOI}, fetching references...`, type: "default" });
              const result=await this.utils.API.getReferenceList(DOI,url,title,task.signal);references=result.references;resultSource=result.source;
              if(result.partial)resultSource+=` (${references.length}${result.expected?"/"+result.expected:"+"} · ${getString("cards-partial")})`;
            }
          }

          // 若 API 未能获取到参考文献，且当前存在 PDF reader，优雅降级至本地 PDF 智能提取
          if (!task.isCurrent()) return;
          if ((!references || references.length === 0) && !reader) reader=await this.getReaderForItem(item,task.signal) as any;
          if (!task.isCurrent()) return;
          if ((!references || references.length === 0) && reader) {
            if (!popupWin) {
              popupWin = new ztoolkit.ProgressWindow("[Fallback] PDF", { closeTime: -1 });
              popupWin.show();
            }
            popupWin.changeHeadline("[Fallback] PDF");
            popupWin.changeLine({ text: "API未收录引文，正在启用本地 PDF 解析...", type: "default" });
            try {
              references = await this.utils.PDF.getReferences(reader, fromCurrentPage,{signal:task.signal,notify:false});
              resultSource="PDF fallback";
            } catch (pdfErr) {
              ztoolkit.log("PDF fallback error:", pdfErr);
            }
          }

          if (!task.isCurrent()) return;
          if (references?.length && resultSource!=="PDF fallback" && Zotero.Prefs.get(`${config.addonRef}.saveAPIReferences`)) {
            await this.storage.set(item,key,cacheReferences(references,signature));
          }
          if (popupWin) {
            popupWin.changeHeadline(references?.length ? "[Done]" : "[Empty]");
            popupWin.changeLine({ text: `${references?.length || 0} references`, type: references?.length ? "success" : "fail" });
            popupWin.startCloseTimer(3000);
          }
        } catch (apiErr) {
          ztoolkit.log("refreshReferences API error:", apiErr);
          if (popupWin) {
            popupWin.changeHeadline("[Fail] API");
            popupWin.changeLine({ text: "API请求失败，请稍后重试", type: "fail" });
            popupWin.startCloseTimer(3000);
          }
          throw apiErr;
        } finally {
          popupWin?.close();
        }
      }
    }

    if (!task.isCurrent()) return;
    if (!references) {
      references = [];
    }
    const referenceNum = references.length;
    // @ts-ignore
    panel.references = references;

    const currentSource = resultSource;
    panel.setAttribute("data-refnexus-result-source",resultSource);
    const refreshBtn = panel.querySelector("#refresh-button") as HTMLButtonElement;
    if (refreshBtn) {
      const tooltipTpl = getString("relatedbox-source-tooltip") || "当前来源: { $source } (点击切换模式，长按强制更新)";
      refreshBtn.title = tooltipTpl.replace("{ $source }", currentSource);
    }

    if (referenceNum === 0) {
      label.textContent = `${getString(["Auto","Web","PDF"].includes(source)?"cards-auto-empty":"relatedbox-empty")} [${currentSource}]`;
      return;
    }
    const sort=Zotero.Prefs.get(`${config.addonRef}.sortBy`);
    const displayed=[...references];
    if(sort==="Recency")displayed.sort((a,b)=>Number(b.year||0)-Number(a.year||0));
    if(sort==="Cited Count")displayed.sort((a,b)=>Number((b as any).citationCount||0)-Number((a as any).citationCount||0));
    await (panel as any)._cards?.render(displayed,task.isCurrent);
    if(!task.isCurrent())return;
    (panel as any)._setL10nArgs?.(JSON.stringify({count:referenceNum}));
    label.innerText = `${referenceNum} ${getString("relatedbox-number-label")} [${currentSource}]`;
    if (reader && this.utils.PDF.getDiagnostics(reader)?.scanLimited) label.textContent+=` · ${getString("relatedbox-scan-limited")}`;
  }

  public showTipUI(refRect: Rect, reference: ItemInfo, position: string, idText?: string, localOnly: boolean = false) {
    let toTimeInfo = (t: string) => {
      if (!t) { return undefined }
      let info = (new Date(t)).toString().split(" ")
      return `${info[1]} ${info[3]}`
    }
    let tipUI = new TipUI()
    tipUI.onInit(refRect, position)
    const refText = reference.text!;
    let getDefalutInfoByReference = async () => {
      const localItem = reference._item
      let info: ItemInfo
      if (localItem) {
        info = {
          identifiers: {},
          authors: localItem.getCreators().map((i: any) => i.firstName + " " + i.lastName),
          tags: localItem.getTags().map((i: any) => {
            let ctag: any = localItem.getColoredTags().find((ci: any) => ci.tag == i.tag)
            if (ctag) {
              return {text: i.tag, color: ctag.color}
            } else {
              return i.tag
            }
          }),
          abstract: localItem.getField("abstractNote") as string,
          title: localItem.getField("title") as string,
          year: localItem.getField("year") as string,
          primaryVenue: localItem.getField("publicationTitle") as string,
          type: "",
          source: reference.source || undefined
        }
      } else {
        info = {
          identifiers: reference.identifiers || {},
          authors: reference.authors || [],
          type: "",
          year: reference.year || undefined,
          title: reference.title || idText || "Reference",
          tags: reference.tags || [],
          text: reference.text || refText,
          abstract: reference.abstract || refText,
          primaryVenue: reference.primaryVenue || undefined
          
        }
        let url = this.utils.identifiers2URL(info.identifiers)
        if (url) {
          info.url = url
        }
      }
      return info
    }
    let coroutines: Promise<ItemInfo | undefined>[], prefIndex: number, according: string
    if(localOnly) {
      according="Zotero";prefIndex=0;coroutines=[getDefalutInfoByReference()];
    } else if (reference?.identifiers.arXiv) {
      according = "arXiv"
      coroutines = [
        getDefalutInfoByReference(),
        this.utils.API.getArXivInfo(reference.identifiers.arXiv)
      ]
      prefIndex = parseInt(Zotero.Prefs.get(`${config.addonRef}.${according}InfoIndex`) as string)
    } else if (reference?.identifiers.DOI) {
      according = "DOI"
      coroutines = [
        getDefalutInfoByReference(),
        this.utils.API.getDOIInfoBySemanticscholar(reference.identifiers.DOI),
        this.utils.API.getTitleInfoByReadpaper(refText, {}, reference.identifiers.DOI),
        this.utils.API.getTitleInfoByConnectedpapers(reference.identifiers.DOI),
        this.utils.API.getDOIInfoByCrossref(reference.identifiers.DOI)
      ]
      prefIndex = parseInt(Zotero.Prefs.get(`${config.addonRef}.${according}InfoIndex`) as string)
    } else {
      according = "Title";
      const searchTitle = reference.title || reference.text || "";
      coroutines = [
        getDefalutInfoByReference(),
        this.utils.API.getTitleInfoByReadpaper(searchTitle),
        this.utils.API.getTitleInfoByCrossref(searchTitle),
        this.utils.API.openAlex.searchWorkByTitle(searchTitle).then(oa => {
          if (!oa) return undefined;
          return {
            identifiers: oa.doi ? { DOI: oa.doi } : {},
            title: oa.title,
            authors: oa.authors,
            year: oa.year,
            type: "journalArticle",
            primaryVenue: oa.venue,
            source: "openalex",
            url: oa.doi ? `https://doi.org/${oa.doi}` : undefined,
            oaUrl: oa.oaUrl,
            tags: oa.citationCount ? [{ text: `Cited: ${oa.citationCount}`, color: "#d9480f", tip: "Citations (OpenAlex)" }] : []
          } as ItemInfo;
        }),
        this.utils.API.getTitleInfoByConnectedpapers(searchTitle),
        this.utils.API.getTitleInfoByCNKI(searchTitle)
      ];
      prefIndex = parseInt(Zotero.Prefs.get(`${config.addonRef}.${according}InfoIndex`) as string);
    }
    const sourceConfig = {
      arXiv: { color: "#b31b1b", tip: "arXiv is a free distribution service and an open-access archive for 2,186,475 scholarly articles in the fields of physics, mathematics, computer science, quantitative biology, quantitative finance, statistics, electrical engineering and systems science, and economics. Materials on this site are not peer-reviewed by arXiv." },
      readpaper: { color: "#1f71e0", tip: "论文阅读平台ReadPaper共收录近2亿篇论文、2.7亿位作者、近3万所高校及研究机构，几乎涵盖了全人类所有学科。科研工作离不开论文的帮助，如何读懂论文，读好论文，这本身就是一个很大的命题，我们的使命是：“让天下没有难读的论文”" },
      semanticscholar: { color: "#1857b6", tip: "Semantic Scholar is an artificial intelligence–powered research tool for scientific literature developed at the Allen Institute for AI and publicly released in November 2015. It uses advances in natural language processing to provide summaries for scholarly papers. The Semantic Scholar team is actively researching the use of artificial-intelligence in natural language processing, machine learning, Human-Computer interaction, and information retrieval." },
      crossref: { color: "#89bf04", tip: "Crossref is a nonprofit association of approximately 2,000 voting member publishers who represent 4,300 societies and publishers, including both commercial and nonprofit organizations. Crossref includes publishers with varied business models, including those with both open access and subscription policies." },
      connectedpapers: { color: "#35999a", tip: "Connected Papers is a visual tool to help researchers and applied scientists find academic papers relevant to their field of work."},
      openalex: { color: "#d9480f", tip: "OpenAlex is a free and open bibliographic database of global scholarly research with over 250M works, indexing citations and open-access links." },
      DOI: { color: "#fcb426" },
      Zotero: { color: "#d63b3b", tip: "Zotero is a free, easy-to-use tool to help you collect, organize, cite, and share your research sources." },
      CNKI: { color: "#1b66e6", tip: "中国知网知识发现网络平台—面向海内外读者提供中国学术文献、外文文献、学位论文、报纸、会议、年鉴、工具书等各类资源统一检索、统一导航、在线阅读和下载服务。" }
    }
    for (let i = 0; i < coroutines.length; i++) {
      // 不阻塞
      window.setTimeout(async () => {
        let info = await coroutines[i].catch(e => {
          ztoolkit.log("Tip coroutine error:", e);
          return undefined;
        });
        if (!info) { return }
        const tagDefaultColor = "#59C1BD"
        let tags = (info.tags || []).map((tag: object | string) => {
          if (typeof tag == "object") {
            return { color: tagDefaultColor, ...(tag as object) }
          } else {
            return { color: tagDefaultColor, text: tag }
          }
        }) as any || []
        // 展示撤稿警示 tag
        if (reference.retraction?.isRetracted) {
          tags.unshift({
            text: getString("relatedbox-retracted-badge") || "🚨 已撤稿",
            color: "#e03131",
            tip: reference.retraction.reason || getString("relatedbox-retracted-reason") || "该论文已被学术期刊或机构撤回"
          });
        }
        // 展示当前数据源tag
        if (info.source) { tags.push({ text: info.source, ...sourceConfig[info.source as keyof typeof sourceConfig], source: info.source }) }
        // 展示可点击跳转链接tag
        if (info.identifiers?.DOI) {
          let DOI = info.identifiers.DOI
          tags.push({ text: "DOI", color: sourceConfig.DOI.color, tip: DOI, url: info.url })
        }
        if (info.identifiers?.arXiv) {
          let arXiv = info.identifiers.arXiv
          tags.push({ text: "arXiv", color: sourceConfig.arXiv.color, tip: arXiv, url: info.url })
        }
        if (info.identifiers?.CNKI) {
          let url = info.identifiers.CNKI
          tags.push({ text: "URL", color: sourceConfig.CNKI.color, tip: url, url: info.url })
        }
        if (reference._item) {
          // 用本地Item更新数据
          tags.push({ text: "Zotero", color: sourceConfig.Zotero.color, tip: sourceConfig.Zotero.tip, item: reference._item })
        }
        // 添加
        tipUI.addTip(
          this.utils.Html2Text(info.title!)!,
          tags,
          [
            info.authors?.slice(0, 3).join(" / "),
            [info?.primaryVenue, toTimeInfo(info.publishDate as string) || info.year]
              .filter(e => e).join(" \u00b7 "),
            reference.description
          ].filter(s => s && s != ""),
          this.utils.Html2Text(info.abstract!)!,
          according,
          i,
          prefIndex
        )
      })
    }
    return tipUI
  }

}
