import { config } from "../../package.json";
import { initLocale, getString } from "../utils/locale";
import TipUI from "./tip";
import Utils from "./utils";
import LocalStorge from "./localStorage";
import BatchImporter from "./batchImporter";
import ReferenceCards from "./referenceCards";
import ReferenceTasks, { ReferenceTaskContext } from "./referenceTasks";
import { cacheReferences, readCachedReferences, cacheReferenceResult, readCachedReferenceResult, preferCachedReferences } from "./referenceCache";
import { retrieveReferenceList, normalizeReferenceResult, ReferenceProvider, ReferenceResult } from "./referenceRetrieval";
import CitationVerifier from "./verifier";
import {workIdentity} from "./workIdentity";
import {referenceData} from "./referenceData";
import {renderReferenceSourceDetails, ReferenceSourceEvidence, safeProviderAttempt} from "./referenceSourceDetails";
import {importErrorText} from "./importErrors";
import { cleanupSync, cleanupAsync } from "../utils/lifecycle";


export default class Views {
  public utils!: Utils;
  public readonly referenceTasks = new ReferenceTasks();
  public readonly storage = new LocalStorge(config.addonRef);
  private paneID?: string;
  private notifierID?: string;
  private disposed = false;
  private panes=new Set<HTMLElement>();
  public async runSettingsAction(action:string):Promise<string> {
    if(this.disposed)throw new Error(getString('cards-context-changed'));
    const win=Zotero.getMainWindow();
    if(!win)throw new Error(getString('cards-settings-no-selection'));
    const reader=this.utils.getReader(win as unknown as Window);
    const attachment=reader?.itemID?Zotero.Items.get(reader.itemID):undefined;
    const selected=attachment?[attachment]:(win.ZoteroPane?.getSelectedItems?.() || []);
    if(selected.length!==1)throw new Error(getString('cards-settings-no-selection'));
    const item=selected[0].parentItem || selected[0];
    if(!item?.isRegularItem() || item.deleted)throw new Error(getString('cards-settings-no-selection'));
    const findBody=()=>{
      const context=(win as any).document?.getElementById('zotero-context-pane-inner');
      return [...this.panes].find(node=>node.isConnected && node.ownerDocument.defaultView===(win as unknown as Window)
        && Number(node.getAttribute('data-refflow-item-id'))===item.id
        && (attachment ? Boolean(context?.contains(node)) : !context?.contains(node)));
    };
    let body=findBody();
    // The item pane is lazily created. Open the selected library item only if no
    // matching reader or library pane exists, then wait for the native render.
    if(!body){
      const context=(win as any).document.getElementById('zotero-context-pane-inner');
      if(attachment){if(context)context.collapsed=false;}
      else {(win as any).Zotero_Tabs?.select('zotero-pane');await win.ZoteroPane.selectItem(item.id);}
      for(let i=0;i<100&&!body;i++){
        const scope=attachment?context:(win as any).document;
        const section=scope?.querySelector('item-pane-custom-section[data-pane$="-refflow-references"] collapsible-section');
        if(section) section.open=true;
        await Zotero.Promise.delay(30);body=findBody();
      }
    }
    if(!body || !(body as any)._cards)throw new Error(getString('cards-settings-open-pane'));
    const contextStillMatches=()=>{
      if(!body!.isConnected || Number(body!.getAttribute('data-refflow-item-id'))!==item.id || item.deleted)return false;
      const activeReader=this.utils.getReader(win as unknown as Window);
      if(attachment)return activeReader?.itemID===attachment.id;
      const current=win.ZoteroPane?.getSelectedItems?.()||[];
      return !activeReader && current.length===1 && (current[0].parentItem||current[0]).id===item.id;
    };
    if(!contextStillMatches())throw new Error(getString('cards-context-changed'));
    if(action!=='rollback' && !((body as any).references?.length)){
      await this.refreshReferences(body as any,true,false,false,item,reader);
      if(!contextStillMatches())throw new Error(getString('cards-context-changed'));
      if(!((body as any).references?.length))throw new Error(getString('cards-settings-no-results'));
    }
    if(!contextStillMatches())throw new Error(getString('cards-context-changed'));
    const result=await (body as any)._cards.runSettingsAction(action);
    return getString('cards-settings-target-result',{args:{title:String(item.getField("title")||""),result}});
  }
  public updateSourceDetailsVisibility():void {
    for(const body of this.panes){const details=body.querySelector<HTMLDetailsElement>('#refflow-source-details');if(details)details.hidden=Zotero.Prefs.get(`${config.addonRef}.showSourceDetails`)===false || !details.childElementCount;}
  }
  private libraryTimer?:ReturnType<typeof globalThis.setTimeout>;
  private changedLibraries=new Set<number>();
  private unknownLibraryChange=false;
  private tips=new Map<Window,TipUI>();
  private localizationDocuments=new Set<Document>();
  private menus=new Set<Element>();
  private importJobs=new Map<string,{job:ReturnType<typeof BatchImporter.importAll>;refs:ItemBaseInfo[]}>();
  private importOwnerIDs=new WeakMap<object,number>();
  private importOwnerSequence=0;
  private pendingImports=new WeakMap<Element,Map<number,number>>();
  private syncCancelButton(body:Element):void {
    const cancel=body.querySelector<HTMLElement>('#refflow-cancel');
    if(!cancel)return;
    const itemID=Number(body.getAttribute('data-refflow-item-id'));
    this.pendingImports ??= new WeakMap();
    cancel.hidden=!body.hasAttribute('aria-busy') && !(this.pendingImports.get(body)?.get(itemID));
  }
  public settingsError(error:unknown):string {return safeProviderAttempt(importErrorText(error));}
  constructor() {
    initLocale();
    this.utils = new Utils()
    BatchImporter.setUtils(this.utils);
  }

  public attachWindow(win: Window) {
    this.attachDocument(win.document);
    if (!win.document.getElementById(`${config.addonRef}-style`)) this.addStyle(win.document);
  }

  public detachWindow(win: Window) {
    for(const menu of this.menus)if(menu.ownerDocument===win.document){cleanupSync(()=>menu.remove());this.menus.delete(menu);}
    cleanupSync(() => this.tips.get(win)?.clear());this.tips.delete(win);
    win.document.querySelectorAll(`item-pane-custom-section[data-pane$="-${config.addonRef}-references"] [data-type="body"]`).forEach(body => {
      cleanupSync(() => BatchImporter.cancelImports(undefined,body));
      cleanupSync(() => this.referenceTasks.invalidate(body));
      cleanupSync(() => (body as any)._cards?.dispose());
      this.panes.delete(body as HTMLElement);
    });
    cleanupSync(() => win.document.getElementById(`${config.addonRef}-style`)?.remove());
    cleanupSync(() => (win.document as any).l10n?.removeResourceIds([`${config.addonRef}-addon.ftl`]));
    this.localizationDocuments.delete(win.document);
  }

  public attachDocument(doc: Document) {
    if (this.localizationDocuments.has(doc)) return;
    (doc as any).l10n?.addResourceIds([`${config.addonRef}-addon.ftl`]);
    this.localizationDocuments.add(doc);
  }

  private addStyle(doc: Document = document) {
    const styles = ztoolkit.UI.createElement(doc, "style", {
      id: `${config.addonRef}-style`,
      properties: {
        innerHTML: `
          .refflow-card-search {box-sizing:border-box;width:100%;margin:4px 0 6px;padding:5px 8px;border:1px solid var(--material-border,#ccc);border-radius:4px;background:var(--material-background,#fff);color:inherit;}
          .refflow-status {font-size:.85em;opacity:.75;border:0!important;padding:0!important;min-height:18px;}
          .zotero-editpane-related[data-refflow-item-id] .reference-item {display:flex;flex-direction:column;gap:4px;padding:6px 4px;border-radius:4px;cursor:default;min-width:0;}
          .zotero-editpane-related[data-refflow-item-id] .refflow-journal-status {padding:8px;margin-block:8px;border:1px solid currentColor;border-radius:7px;overflow-wrap:anywhere;}
          .zotero-editpane-related[data-refflow-item-id] .refflow-source-details {box-sizing:border-box;width:100%;margin-block:4px;padding:6px 8px;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:6px;background:color-mix(in srgb,currentColor 2%,transparent);color:inherit;overflow-wrap:anywhere;}
          .zotero-editpane-related[data-refflow-item-id] .refflow-source-details summary {cursor:pointer;font-weight:600;}
          .zotero-editpane-related[data-refflow-item-id] .refflow-source-details p {margin-block:5px;font-size:.95em;}
          .zotero-editpane-related[data-refflow-item-id] .refflow-source-details ul {margin-block:4px;padding-inline-start:2em;max-height:12em;overflow:auto;}
          .zotero-editpane-related[data-refflow-item-id] .refflow-source-details li {margin-block:3px;}
          .zotero-editpane-related[data-refflow-item-id] .refflow-source-details :focus-visible {outline:2px solid var(--color-accent,#3678b5);outline-offset:2px;}
          .zotero-editpane-related[data-refflow-item-id] .refflow-journal-status button {font:inherit;margin:3px;max-width:100%;white-space:normal;}
          .zotero-editpane-related[data-refflow-item-id] .refflow-batch-results {margin-block:8px;padding:8px;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:7px;background:color-mix(in srgb,currentColor 2%,transparent);font:inherit;overflow-wrap:anywhere;}
          .zotero-editpane-related[data-refflow-item-id] .refflow-batch-results summary {cursor:pointer;font-weight:600;}
          .zotero-editpane-related[data-refflow-item-id] .refflow-batch-results p {margin-block:6px;font-size:.95em;}
          .zotero-editpane-related[data-refflow-item-id] .refflow-batch-failures {max-height:16em;overflow:auto;padding-inline-start:2.5em;}
          .zotero-editpane-related[data-refflow-item-id] .refflow-batch-failures li {margin-block:8px;}
          .zotero-editpane-related[data-refflow-item-id] .refflow-batch-actions {display:flex;flex-wrap:wrap;gap:6px;}
          .zotero-editpane-related[data-refflow-item-id] .refflow-batch-actions button {font:inherit;max-width:100%;white-space:normal;}
          .zotero-editpane-related[data-refflow-item-id] .refflow-batch-results :focus-visible {outline:2px solid var(--color-accent,#3678b5);outline-offset:2px;}
          .zotero-editpane-related[data-refflow-item-id] .reference-item[hidden] {display:none!important;}
          .zotero-editpane-related[data-refflow-item-id] .reference-item:hover {background:var(--material-mix-quinary,rgba(128,128,128,.08));}
          .zotero-editpane-related[data-refflow-item-id] .reference-item.selected {background:var(--color-accent-10,rgba(60,120,200,.16));}
          .zotero-editpane-related[data-refflow-item-id] .reference-item:focus-visible {outline:1px solid var(--color-accent,#3678b5);outline-offset:-1px;}
          .zotero-editpane-related[data-refflow-item-id] .reference-citation {display:grid;grid-template-columns:var(--refflow-number-width,3ch) minmax(0,1fr);column-gap:6px;align-items:start;}
          .zotero-editpane-related[data-refflow-item-id] .reference-marker {min-width:0;text-align:end;font-size:.9em;line-height:1.35;}
          .zotero-editpane-related[data-refflow-item-id] .reference-number {font-variant-numeric:tabular-nums;font-weight:600;font-size:inherit;line-height:1.35;color:inherit;white-space:nowrap;}
          .zotero-editpane-related[data-refflow-item-id] .reference-description {display:flex;flex-direction:column;gap:3px;min-width:0;overflow-wrap:anywhere;}
          .zotero-editpane-related[data-refflow-item-id] .reference-heading {display:grid;grid-template-columns:var(--refflow-number-width,3ch) minmax(0,1fr) max(24px,1.75em);column-gap:6px;align-items:start;}
          .zotero-editpane-related[data-refflow-item-id] .reference-state {width:max(8px,.55em);height:max(8px,.55em);border-radius:50%;justify-self:center;margin-block-start:calc((1.5em - max(8px,.55em))/2);}
          .zotero-editpane-related[data-refflow-item-id] .reference-text {font-size:.9em;line-height:1.35;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;overflow-wrap:anywhere;}
          .zotero-editpane-related[data-refflow-item-id] .reference-title {font-size:1em;line-height:1.5;min-width:0;}
          .zotero-editpane-related[data-refflow-item-id] .reference-metadata {margin-inline-start:calc(var(--refflow-number-width,3ch) + 6px);}
          .zotero-editpane-related[data-refflow-item-id] .reference-about {font-size:.85em;opacity:.6;}
          .zotero-editpane-related[data-refflow-item-id] .reference-retracted {color:var(--color-red,#b42318);margin-inline-start:calc(var(--refflow-number-width,3ch) + 6px);}
          .zotero-editpane-related[data-refflow-item-id] .reference-action {appearance:none;box-sizing:border-box;display:grid;place-items:center;margin:0;margin-block-start:calc((1.5em - max(24px,1.75em))/2);padding:0;border:1px solid transparent;background:transparent;color:inherit;border-radius:5px;inline-size:max(24px,1.75em);block-size:max(24px,1.75em);cursor:pointer;font:inherit;line-height:1;}
          .zotero-editpane-related[data-refflow-item-id] .reference-action svg {display:block;width:1.1em;height:1.1em;pointer-events:none;}
          .zotero-editpane-related[data-refflow-item-id] .reference-action:hover {background:var(--material-mix-quaternary,rgba(128,128,128,.15));}
          .zotero-editpane-related[data-refflow-item-id] .reference-action:focus-visible {outline:2px solid var(--color-accent,#3678b5);outline-offset:1px;}
          .zotero-editpane-related[data-refflow-item-id] .reference-action:disabled {cursor:progress;}
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
    this.notifierID = Zotero.Notifier.registerObserver({ notify: (_event:any,_type:any,ids:any[],extra:any) => {
      if (this.disposed) return;
      const libraries=new Set<number>();
      for(const id of ids||[]){const item=Zotero.Items.get(Number(id));const libraryID=item?item.libraryID:Number(extra?.[id]?.libraryID);if(libraryID)libraries.add(libraryID);else this.unknownLibraryChange=true;}
      if(!ids?.length)this.unknownLibraryChange=true;
      libraries.forEach(id=>this.changedLibraries.add(id));
      this.utils.clearLibraryItemCache(this.unknownLibraryChange?undefined:libraries);
      globalThis.clearTimeout(this.libraryTimer);
      this.libraryTimer=globalThis.setTimeout(()=>{
        if(this.disposed)return;
        for(const body of this.panes){const item=Zotero.Items.get(Number(body.getAttribute('data-refflow-item-id')));if(body.isConnected&&(this.unknownLibraryChange||item&&this.changedLibraries.has(item.libraryID)))(body as any)._cards?.invalidateLibraryMatches();}
        this.changedLibraries.clear();this.unknownLibraryChange=false;
      },100);
    } }, ["item"], config.addonRef);
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
      sidenav: { l10nID: "refflow-pane-sidenav", icon },
      header: { l10nID: "refflow-pane-title",l10nArgs:JSON.stringify({count:0}), icon: `chrome://${config.addonRef}/content/icons/reference.svg` },
      sectionButtons:[
        {type:"type",icon:`chrome://${config.addonRef}/content/icons/type.svg`,l10nID:"refflow-pane-type",onClick:({body,item})=>this.typeMenu(body,item)},
        {type:"refresh",icon:`chrome://${config.addonRef}/content/icons/refresh.svg`,l10nID:"refflow-pane-refresh",onClick:({body,item})=>this.refreshReferences(body as any,false,false,false,item?.parentItem||item)},
        {type:"more",icon:`chrome://${config.addonRef}/content/icons/more.svg`,l10nID:"refflow-pane-more",onClick:({body})=>(body as any)._cards?.menu()}
      ],
      onRender: ({ body, item, setL10nArgs }) => {
        this.panes.add(body as HTMLElement);
        this.attachDocument(body.ownerDocument);
        if(!body.ownerDocument.getElementById(`${config.addonRef}-style`))this.addStyle(body.ownerDocument);
        const identity=String(item?.parentItem?.id || item?.id || "");
        if((body as any)._cards && body.getAttribute("data-refflow-item-id")===identity && body.querySelector(".refflow-card-search")) {
          (body as any)._setL10nArgs=setL10nArgs;
          setL10nArgs(JSON.stringify({count:(body as any).references?.length||0}));
          return;
        }
        this.referenceTasks.invalidate(body);
        body.replaceChildren();
        (body as any).references = [];
        body.setAttribute("data-refflow-type",String(Zotero.Prefs.get(`${config.addonRef}.type`)||"References"));
        body.classList.add("zotero-editpane-related");
        body.setAttribute("data-refflow-item-id", String(item?.parentItem?.id || item?.id || ""));
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
          body.setAttribute("data-refflow-type", "References");
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
          const currentItem = Zotero.Items.get(Number(body.getAttribute("data-refflow-item-id"))) as Zotero.Item | undefined;
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
        force.type = "button"; force.id = "refflow-force-refresh";
        force.textContent = getString("relatedbox-force-label");
        force.addEventListener("click", () => this.refreshReferences(body as any, false).catch(error => ztoolkit.log(error)));
        const cancel = body.ownerDocument.createElement("button");
        cancel.type = "button"; cancel.id = "refflow-cancel"; cancel.hidden = true;
        cancel.textContent = getString("relatedbox-cancel-label");
        cancel.addEventListener("click", () => { this.cancelReferencePane(body); count.textContent=getString("relatedbox-cancelled")+((body as any).references?.length?` · ${getString("cards-kept-results")}`:""); });
        controls.style.flexWrap = "wrap";
        controls.style.gap = "6px";
        controls.classList.add("refflow-status");
        // The original XPI keeps operations in the collapsible-section header.
        source.hidden=true;refresh.hidden=true;force.hidden=true;
        controls.append(count, source, refresh, force, cancel);
        const sourceDetails=body.ownerDocument.createElement("details");
        sourceDetails.id="refflow-source-details";
        sourceDetails.hidden=true;
        const search=body.ownerDocument.createElement("input");search.type="search";search.className="refflow-card-search";
        search.placeholder=getString("relatedbox-search-placeholder");search.setAttribute("aria-label",search.placeholder);

        const grid = body.ownerDocument.createElement("div");
        grid.id = "related-grid";
        grid.className = "grid";
        grid.style.overflowY = "auto";
        grid.style.display="flex";grid.style.flexDirection="column";
        body.append(search,controls,sourceDetails,grid);
        (body as any)._cards?.dispose();
        (body as any)._cards=new ReferenceCards(this,body,grid,search,getString('cards-list-name'));
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
        if(body.getAttribute("data-refflow-item-id")===identity)return;
        this.resetReferencePane(body);
        body.setAttribute("data-refflow-item-id", String(item?.parentItem?.id || item?.id || ""));
        this.syncCancelButton(body);
      },
      onDestroy: ({ body }) => {BatchImporter.cancelImports(undefined,body);this.panes.delete(body as HTMLElement);this.referenceTasks.invalidate(body);(body as any)._cards?.dispose();}
    });
    if (!registered) {
      ztoolkit.log("Zotero refused to register the RefFlow item-pane section");
    }
    if (registered) this.paneID = registered;
  }

  private resetReferencePane(body: Element): void {
    this.referenceTasks.invalidate(body);
    (body as any).references=[];
    (body as any)._cards?.clear();
    (body as any)._setL10nArgs?.(JSON.stringify({count:0}));
    body.querySelector("#related-grid")?.replaceChildren();
    const sourceDetails=body.querySelector("#refflow-source-details") as HTMLDetailsElement|undefined;
    if(sourceDetails){sourceDetails.replaceChildren();sourceDetails.hidden=true;sourceDetails.open=false;}
    body.removeAttribute("aria-busy");
    const count=body.querySelector("#reference-num");
    if (count) count.textContent=`0 ${getString("relatedbox-number-label")}`;
    body.querySelectorAll("button").forEach(button=>{ (button as HTMLButtonElement).disabled=false; });
    const cancel=body.querySelector("#refflow-cancel") as HTMLElement;
    if (cancel) this.syncCancelButton(body);
  }

  private cancelReferencePane(body:Element):void {
    BatchImporter.cancelImports(Number(body.getAttribute('data-refflow-item-id')),body);
    this.referenceTasks.invalidate(body);
    body.removeAttribute("aria-busy");
    body.querySelectorAll("#refresh-button, #refflow-force-refresh").forEach(button=>(button as HTMLButtonElement).disabled=false);
    const cancel=body.querySelector("#refflow-cancel") as HTMLElement;if(cancel)cancel.hidden=true;
  }

  private typeMenu(body:HTMLElement,item?:Zotero.Item) {
    if(this.disposed)return;
    const doc:any=body.ownerDocument,popup=doc.createXULElement("menupopup");
    const ownerID=body.getAttribute("data-refflow-item-id");
    popup.setAttribute("data-refflow-menu", "literature");
    for(const [type,key] of [["References","cards-type-references"],["Citations","cards-type-citations"],["Related","cards-type-related"]]) {
      const entry=doc.createXULElement("menuitem");entry.setAttribute("label",getString(key));entry.setAttribute("type","radio");entry.checked=body.getAttribute("data-refflow-type")===type;
      entry.addEventListener("command",()=>Promise.resolve().then(async()=>{if(this.disposed||!body.isConnected||body.getAttribute("data-refflow-item-id")!==ownerID)return;this.resetReferencePane(body);body.setAttribute("data-refflow-type",type);Zotero.Prefs.set(`${config.addonRef}.type`,type);body.setAttribute("source",type==="References"?String(Zotero.Prefs.get(`${config.addonRef}.prioritySource`)||"PDF"):"API");await this.refreshReferences(body as any,true,false,false,item?.parentItem||item);}).catch(error=>ztoolkit.log(error)));popup.append(entry);
    }
    this.menus.add(popup);
    popup.addEventListener("popuphidden",()=>{this.menus.delete(popup);popup.remove();},{once:true});doc.documentElement.append(popup);popup.openPopup(body.closest("item-pane-custom-section"),"after_end",0,0,false,false);
  }

  public async shutdown(): Promise<void> {
    if (this.disposed) return;
    this.disposed=true;
    cleanupSync(() => globalThis.clearTimeout(this.libraryTimer));
    for(const menu of this.menus)cleanupSync(()=>menu.remove());this.menus.clear();
    for (const body of this.panes) cleanupSync(() => (body as any)._cards?.dispose());
    this.panes.clear();
    for(const tip of this.tips.values()) cleanupSync(() => tip.clear());
    this.tips.clear();
    cleanupSync(() => this.referenceTasks.dispose());
    await cleanupAsync(() => BatchImporter.shutdown());
    cleanupSync(() => this.utils.API.requests.dispose());
    cleanupSync(() => this.utils.API.publisherReferences.dispose());
    const notifierID = this.notifierID, paneID = this.paneID;
    this.notifierID = this.paneID = undefined;
    if (notifierID) cleanupSync(() => Zotero.Notifier.unregisterObserver(notifierID));
    if (paneID) cleanupSync(() => Zotero.ItemPaneManager.unregisterSection(paneID));
    await cleanupAsync(() => this.storage.dispose());
    for(const win of Zotero.getMainWindows()) cleanupSync(() => {
      win.document.getElementById(`${config.addonRef}-style`)?.remove();
    });
    for (const doc of this.localizationDocuments) cleanupSync(() =>
      (doc as any).l10n?.removeResourceIds([`${config.addonRef}-addon.ftl`]));
    this.localizationDocuments.clear();
  }

  public async importReferences(parent: Zotero.Item, refs: ItemBaseInfo[], options: any = {}) {
    if(this.disposed)throw new Error('RefFlow is stopping');
    refs=[...refs];
    options={downloadOA:true,createSubCollection:true,createManifestNote:true,...options};
    let ownerID=0;
    if(options.owner){this.importOwnerIDs??=new WeakMap();ownerID=this.importOwnerIDs.get(options.owner)||0;
      if(!ownerID){ownerID=this.importOwnerSequence=(this.importOwnerSequence||0)+1;this.importOwnerIDs.set(options.owner,ownerID);}}
    const key=JSON.stringify([parent.libraryID,parent.id,refs.map(workIdentity),options.collections??parent.getCollections(),(options.relatedParents||[]).map((item:Zotero.Item)=>item.id),Boolean(options.createSubCollection),Boolean(options.createManifestNote),Boolean(options.downloadOA),Boolean(options.allowMetadataWithoutDOI),options.translatorTimeoutMs??20000,options.budgetMs??300000,ownerID]);
    const pending=this.importJobs.get(key);
    // Independently cancellable callers must not inherit another caller's signal.
    if(pending&&!options.signal){const result=await pending.job;refs.forEach((ref,index)=>{ref._item=pending.refs[index]._item;});return result;}
    const panels=[...this.panes].filter(body=>(!options.owner||options.owner===body)&&Number(body.getAttribute('data-refflow-item-id'))===parent.id);
    this.pendingImports ??= new WeakMap();
    for(const body of panels){let pending=this.pendingImports.get(body);if(!pending){pending=new Map();this.pendingImports.set(body,pending);}pending.set(parent.id,(pending.get(parent.id)||0)+1);this.syncCancelButton(body);}
    let job:ReturnType<typeof BatchImporter.importAll>;
    try{job=BatchImporter.importAll(parent,refs,options);}catch(error){job=Promise.reject(error);}
    if(!options.signal)this.importJobs.set(key,{job,refs});
    try{return await job;}
    finally{if(this.importJobs.get(key)?.job===job)this.importJobs.delete(key);for(const body of panels){const pending=this.pendingImports.get(body);const count=(pending?.get(parent.id)||1)-1;if(count>0)pending?.set(parent.id,count);else pending?.delete(parent.id);this.syncCancelButton(body);}}
  }
  public async rollbackReferences(parent: Zotero.Item, batchID: string) {
    try{
    const outcome=await BatchImporter.rollbackBatchDetailed(parent,batchID),removed=outcome.removed,retained=outcome.retainedIDs.length;
    if(retained)new ztoolkit.ProgressWindow('RefFlow').createLine({text:getString('cards-rollback-retained',{args:{count:retained}}),type:'default'}).show();
    return removed;
    }catch(error){ztoolkit.log('Reference rollback failed',error);const failure=new Error(getString('cards-rollback-failed'));(failure as any).cause=error;throw failure;}
  }

  private getPanelItem(panel: Element): Zotero.Item | undefined {
    const id=Number(panel.getAttribute("data-refflow-item-id"));
    const item=(id?Zotero.Items.get(id):this.utils.getItem(panel.ownerDocument.defaultView!)) || undefined;
    return item?.isAttachment()?item.parentItem:item;
  }

  private readerMatchesItem(reader: any,item: Zotero.Item): boolean {
    const attachment=reader?.itemID?Zotero.Items.get(reader.itemID):undefined;
    return Boolean(attachment && attachment.attachmentContentType==="application/pdf" && (attachment.parentID===item.id || attachment.id===item.id));
  }

  private async pdfAttachment(item: Zotero.Item,reader?: any): Promise<Zotero.Item | undefined> {
    if(this.readerMatchesItem(reader,item))return Zotero.Items.get(reader.itemID) || undefined;
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
    return `pdf-sdt-v3:${attachment.libraryID}:${attachment.key}:${file.fileSize}:${file.lastModifiedTime}`;
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
    const literatureType=panel.getAttribute("data-refflow-type")||"References";
    const source=literatureType==="References"?(panel.getAttribute("source") || (Zotero.Prefs.get(`${config.addonRef}.prioritySource`) as string) || "PDF"):"API";
    panel.setAttribute("source",source);
    const item=itemOverride || this.getPanelItem(panel);
    const label=panel.querySelector("#reference-num");
    if (!item?.isRegularItem()) { if (label) label.textContent=getString("relatedbox-select-item"); return; }
    const ownerID=panel.getAttribute("data-refflow-item-id");
    if(ownerID&&ownerID!==String(item.id))return;
    const metadataIdentity=JSON.stringify([item.libraryID,item.key,item.getField("DOI"),item.getField("title"),item.getField("url"),item.getField("date"),item.getCreators()]);
    const activeReader=readerOverride || this.utils.getReader(panel.ownerDocument.defaultView!);
    const activeAttachment=this.readerMatchesItem(activeReader,item)?Zotero.Items.get(activeReader!.itemID!):undefined;
    const pageIndex=fromCurrentPage&&activeAttachment?activeAttachment.getAttachmentLastPageIndex():undefined;
    const boundIdentity=panel.getAttribute("data-refflow-item-id");
    const windowReader=this.utils.getReader(panel.ownerDocument.defaultView!);
    const checkReader=literatureType==="References"&&source!=="Web"&&this.readerMatchesItem(windowReader,item);
    const sameInput=()=>metadataIdentity===JSON.stringify([item.libraryID,item.key,item.getField("DOI"),item.getField("title"),item.getField("url"),item.getField("date"),item.getCreators()])&&(!checkReader||this.utils.getReader(panel.ownerDocument.defaultView!)?.itemID===activeReader?.itemID);
    const key=`${metadataIdentity}|${activeAttachment?activeAttachment.id:"best"}|${literatureType}|${source}|${fromCurrentPage?"page:"+(pageIndex??"stored"):"full"}|${local?"cache":"force"}`;
    return this.referenceTasks.run(panel,key,async context=>{
      const boundItem=panel.getAttribute("data-refflow-item-id");
      const ownsPanel=()=>context.isCurrent() && panel.isConnected && (panel.getAttribute("data-refflow-type")||"References")===literatureType && panel.getAttribute("source")===source && panel.getAttribute("data-refflow-item-id")===boundItem;
      const current=()=>ownsPanel()&&sameInput();
      panel.setAttribute("aria-busy","true");
      panel.querySelectorAll("#refresh-button, #refflow-force-refresh").forEach(button=>(button as HTMLButtonElement).disabled=true);
      const cancel=panel.querySelector("#refflow-cancel") as HTMLElement;
      if (cancel) cancel.hidden=false;
      try {
        await this.performReferences(panel,local,fromCurrentPage,item,activeReader,{...context,pageIndex,isCurrent:current});
      } catch (error: any) {
        if (current() && label) {label.textContent=(error?.name==="TimeoutError"?getString("relatedbox-timeout"):getString("relatedbox-fetch-error"))+((panel as any).references?.length?` · ${getString("cards-kept-results")}`:"");(label as HTMLElement).title=safeProviderAttempt(String(error?.message||error));}
        if (error?.name!=="AbortError") ztoolkit.log("Reference fetch failed",safeProviderAttempt(String(error?.message||error)));
      } finally {
        if (ownsPanel()) {
          if(!sameInput()&&label)label.textContent=getString("cards-context-changed")+((panel as any).references?.length?` · ${getString("cards-kept-results")}`:"");
          panel.removeAttribute("aria-busy");
          panel.querySelectorAll("#refresh-button, #refflow-force-refresh").forEach(button=>(button as HTMLButtonElement).disabled=false);
          if (cancel) this.syncCancelButton(panel);
        }
      }
    },{onTimeout:()=>{
      if(!panel.isConnected||panel.getAttribute("data-refflow-item-id")!==boundIdentity||panel.getAttribute("source")!==source||(panel.getAttribute("data-refflow-type")||"References")!==literatureType)return;
      if(label)label.textContent=getString(sameInput()?"relatedbox-timeout":"cards-context-changed")+((panel as any).references?.length?` · ${getString("cards-kept-results")}`:"");
      panel.removeAttribute("aria-busy");
      panel.querySelectorAll("#refresh-button, #refflow-force-refresh").forEach(button=>(button as HTMLButtonElement).disabled=false);
      const cancel=panel.querySelector("#refflow-cancel") as HTMLElement;if(cancel)this.syncCancelButton(panel);
    }});
  }

  private mayPersist(result:ReferenceResult):boolean {
    const pdf=/^PDF\b/.test(result.source);
    return Boolean(Zotero.Prefs.get(`${config.addonRef}.${pdf?'savePDFReferences':'saveAPIReferences'}`));
  }

  private async onlineReferences(item:Zotero.Item,task:ReferenceTaskContext,label:HTMLElement):Promise<ReferenceResult|undefined> {
    const api=this.utils.API,url=String(item.getField('url')||''),title=String(item.getField('title')||'');
    let doi=CitationVerifier.normalizeDOI(String(item.getField('DOI')||''))||CitationVerifier.normalizeDOI(url)||'';
    if(!doi){
      let fileName=this.utils.parseCNKIURL(url)?.fileName;
      if(fileName||this.utils.isChinese(title))try{
        if(!fileName){const matched=await api.getTitleInfoByCNKI(title,task.signal);fileName=this.utils.parseCNKIURL(matched?.identifiers?.CNKI||'')?.fileName;}
        if(!task.isCurrent())return;
        if(fileName){const info=await api.getCNKIFileInfo(fileName,0,task.signal);if(info?.references?.length)return {references:info.references,source:'CNKI',partial:info.referencePartial};}
      }catch(error:any){if(task.signal.aborted||error?.name==='AbortError')throw error;ztoolkit.log('CNKI unavailable; continuing DOI resolution',safeProviderAttempt(String(error?.message||error)));}
      if(!task.isCurrent())return;
      label.textContent=getString('cards-resolving-doi');
      const creator=item.getCreators()[0] as any;
      doi=(await api.resolveWork(title,creator?.name||creator?.lastName,String(item.getField('date')),task.signal))?.doi||'';
    }
    if(!doi||!task.isCurrent())return;
    return api.getReferenceList(doi,url,title,task.signal);
  }

  private async smartReferences(item:Zotero.Item,reader:any,task:ReferenceTaskContext,includePDF:boolean,fromCurrentPage:boolean,label:HTMLElement,webFirst=false):Promise<ReferenceResult> {
    const api=this.utils.API,title=String(item.getField("title")),url=String(item.getField("url"));
    let doi=String(item.getField("DOI")||"");
    const resolveDOI=async()=>{
      if(!this.utils.isDOI(doi))doi=CitationVerifier.normalizeDOI(url)||"";
      if(!doi&&task.isCurrent())doi=(await api.resolveWork(title,(item.getCreators()[0] as any)?.lastName,String(item.getField("date")),task.signal))?.doi||"";
      return doi;
    };
    const providers:ReferenceProvider[]=[];
    if(includePDF)providers.push({name:"PDF",run:async()=>{
      const attachment=await this.pdfAttachment(item,reader);
      if(!attachment||!task.isCurrent())return;
      const references=await this.utils.PDF.getReferences(attachment,fromCurrentPage,{signal:task.signal,pageIndex:task.pageIndex,notify:false,onProgress:pages=>{if(task.isCurrent())label.textContent=`${getString("relatedbox-loading")} PDF · ${pages} ${getString("relatedbox-pages-label")}`;}});
      return {references,source:"PDF",partial:this.utils.PDF.getDiagnostics(attachment)?.scanLimited};
    }});
    providers.push({name:"Snapshot",run:async()=>{
      for(const id of item.getAttachments().slice(0,20)) {
        if(!task.isCurrent())return;
        const attachment=Zotero.Items.get(id);if(!attachment||attachment.attachmentContentType!=="text/html"||attachment.deleted)continue;
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
    providers.push({name:"Online",run:()=>this.onlineReferences(item,task,label)});
    return retrieveReferenceList(providers,task.signal,source=>{if(task.isCurrent())label.textContent=`${getString("relatedbox-loading")} ${source}`;});
  }

  private referenceDescription(result:ReferenceResult):string {
    const attempt=result.latestAttempt;
    return result.source+(result.retained?` · ${getString("cards-kept-results")}`:"")+(attempt?` · ${getString('cards-latest-attempt')} ${attempt.count}${attempt.expected?'/'+attempt.expected:attempt.partial?'+':''}`:'')+(result.partial?` (${result.references.length}${result.expected?"/"+result.expected:"+"} · ${getString("cards-partial")})`:"");
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
    let label = panel.querySelector("label#reference-num") as HTMLLabelElement;
    const literatureType=panel.getAttribute("data-refflow-type")||"References";
    const initialSource = panel.getAttribute("source") || "PDF";
    label.textContent = `${getString("relatedbox-loading")} [${initialSource}]`;
    const source=fromCurrentPage && literatureType==="References"?"PDF":initialSource;
    let reader = readerOverride || this.utils.getReader(panel.ownerDocument.defaultView!);
    if(!this.readerMatchesItem(reader,item))reader=undefined as any;
    const signature=source==="PDF"?await this.pdfCacheSignature(item,reader):JSON.stringify(["retrieval-v6",item.getField("DOI"),item.getField("url"),item.getField("title"),item.getField("date"),item.getCreators(),["Auto","API"].includes(source)?await this.pdfCacheSignature(item,reader):"",["Auto","Web"].includes(source)?await this.snapshotSignature(item):[]]);
    if (!task.isCurrent()) return;

    // Keep the last successful same-type list interactive while refreshing.
    // Different literature types must never display each other's results.
    if(panel.getAttribute("data-refflow-result-type")&&panel.getAttribute("data-refflow-result-type")!==literatureType){
      (panel as any)._cards?.clear();(panel as any).references=[];
    }

    let references: ItemBaseInfo[]=[];
    if (!local && ["API","Auto","Web"].includes(source)) this.utils.API.requests.clearCache();
    if(!local&&["API","Auto","Web"].includes(source))this.utils.API.publisherReferences.clearCache();

    let resultSource=source;
    let sourceEvidence:ReferenceSourceEvidence|undefined;
    const setSourceEvidence=(evidence:ReferenceSourceEvidence)=>{
      sourceEvidence=evidence;
      const details=panel.querySelector("#refflow-source-details") as HTMLDetailsElement|undefined;
      if(details){renderReferenceSourceDetails(details,evidence,(key,args)=>args?getString(key,{args}):getString(key));details.hidden=Zotero.Prefs.get(`${config.addonRef}.showSourceDetails`)===false;}
    };
    const showUnavailable=(result:ReferenceResult)=>{
      const previous=panel.querySelector("#refflow-source-details") as HTMLDetailsElement|undefined;
      const displayed=(panel as any).references as ItemBaseInfo[]|undefined;
      const hasDisplayed=Boolean(displayed?.length);
      const count=hasDisplayed?displayed!.length:result.references.length;
      const expected=hasDisplayed&&previous?.dataset.expected?Number(previous.dataset.expected):result.expected;
      setSourceEvidence({
        source:hasDisplayed?(panel.getAttribute("data-refflow-result-source")||result.source):result.source,
        count,
        expected:Number.isSafeInteger(expected)?expected:undefined,
        partial:hasDisplayed?previous?.dataset.partial==="true":Boolean(result.partial),
        retained:hasDisplayed,
        attempts:result.attempts,
        status:hasDisplayed ? (previous?.dataset.status === "partial" ? "partial" : "success") : "unavailable",
        latestAttempt:hasDisplayed ? {source:result.source,count:0,partial:true} : undefined,
      });
    };
    if(literatureType!=="References") {
      const key=`References-API-${literatureType}`;
      const cached=await this.storage.getAsync(item,key);
      const previous=readCachedReferences(cached,signature,cached?.snapshot?.truncated?15*60*1000:24*60*60*1000);
      const describe=(source:string,total:number,truncated:boolean)=>`${source} ${literatureType}${truncated?(Number.isFinite(total)&&total>references.length?` (${references.length}/${total})`:` (${references.length}+ · ${getString("cards-partial")})`):""}`;
      if(local && previous){references=previous;resultSource=describe(cached?.snapshot?.source||"OpenAlex",Number(cached?.snapshot?.total||references.length),Boolean(cached?.snapshot?.truncated));sourceEvidence={source:cached?.snapshot?.source||"OpenAlex",count:references.length,expected:cached?.snapshot?.total,partial:Boolean(cached?.snapshot?.truncated)};}
      else {
        let doi=String(item.getField("DOI")||"");
        if(!doi)doi=(await this.utils.API.resolveWork(String(item.getField("title")),(item.getCreators()[0] as any)?.lastName,String(item.getField("date")),task.signal))?.doi||"";
        if(!task.isCurrent())return;
        if(!doi)throw new Error(getString("cards-work-not-found"));
        let result:any,provider="OpenAlex";
        try {result=await this.utils.API.openAlex.getNeighborhood(doi,literatureType as any,task.signal);}
        catch(error) {
          if(!task.isCurrent())return;
          if(previous){references=previous;resultSource=describe(cached?.snapshot?.source||provider,Number(cached?.snapshot?.total||references.length),Boolean(cached?.snapshot?.truncated))+` · ${getString("cards-cached-offline")}`;label.title=safeProviderAttempt(String(error));}
          else if(literatureType==="Citations") {
            const fallback=await this.utils.API.semanticScholar.neighborhood(doi,"Citations",task.signal);
            if(!task.isCurrent())return;
            if(!fallback || fallback.status==="unavailable" || (!fallback.references.length&&fallback.partial))throw error;
            result={references:fallback.references,total:fallback.partial?undefined:fallback.references.length,truncated:Boolean(fallback.partial)};provider="Semantic Scholar";
          }else throw error;
        }
        if(!task.isCurrent())return;
        if(result){
          const candidate=normalizeReferenceResult({references:result.references,source:provider,expected:result.total,partial:result.truncated});
          const prior=previous?{references:previous,source:cached?.snapshot?.source||provider,expected:cached?.snapshot?.total,partial:cached?.snapshot?.truncated}:undefined;
          const selected=preferCachedReferences(candidate,prior,getString('cards-cached-offline'));
          references=selected.references;resultSource=describe(selected.source,selected.expected!,Boolean(selected.partial))+(selected.retained?` · ${getString('cards-kept-results')}`:'');
          sourceEvidence={source:selected.source,count:selected.references.length,expected:selected.expected,partial:Boolean(selected.partial),retained:selected.retained,attempts:[`${provider}: ${result.references.length}${result.truncated?' (partial)':''}`],status:selected.status};
          if(!selected.retained&&this.mayPersist(selected))await this.storage.set(item,key,{...cacheReferences(references,signature),snapshot:{source:provider,total:result.total,truncated:result.truncated}});
        }
      }
    } else if (source === "Auto" || source === "Web") {
      const key=`References-${source}`;
      const cached=await this.storage.getAsync(item,key);
      const previous=!fromCurrentPage ? readCachedReferenceResult(cached,signature) : undefined;
      let result:ReferenceResult;
      if(local&&previous)result=previous;
      else {
        result=await this.smartReferences(item,reader,task,source!=="Web",fromCurrentPage,label,source==="Web");
        if(!task.isCurrent())return;
        result=preferCachedReferences(result,previous,getString("cards-cached-offline"));
        if(result.references.length&&!result.retained&&!fromCurrentPage&&this.mayPersist(result))await this.storage.set(item,key,cacheReferenceResult(result,signature));
      }
      if(result.status==="unavailable"&&!result.references.length){showUnavailable(result);throw new Error(result.attempts?.join("; ")||"Reference providers unavailable");}
      references=result.references;resultSource=this.referenceDescription(result);
      sourceEvidence={source:result.source,count:result.references.length,expected:result.expected,partial:Boolean(result.partial),retained:result.retained,attempts:result.attempts,status:result.status,latestAttempt:result.latestAttempt};
      label.title=(result.attempts||[]).map(safeProviderAttempt).join("\n");
    } else if (source == "PDF") {
      // 优先本地读取
      const key = "References-PDF";
      const cached=await this.storage.getAsync(item,key);
      let partial=Boolean(cached?.snapshot?.partial);
      references = local && !fromCurrentPage && signature ? readCachedReferences(cached,signature,partial?15*60*1000:Number.MAX_SAFE_INTEGER) as any : undefined;
      if (!task.isCurrent()) return;
      if (references) {
        resultSource="PDF";
        if(partial)resultSource+=` · ${getString("relatedbox-scan-limited")}`;
        sourceEvidence={source:"PDF",count:references.length,partial};
      } else {
        const attachment=await this.pdfAttachment(item,reader);
        if (!task.isCurrent()) return;
        if (!attachment) {
          references = [];
        } else {
          try{references = await this.utils.PDF.getReferences(attachment, fromCurrentPage,{signal:task.signal,pageIndex:task.pageIndex,notify:false,onProgress:scanned=>{if(task.isCurrent()) label.textContent=`${getString("relatedbox-loading")} PDF · ${scanned} ${getString("relatedbox-pages-label")}`;}});}
          catch(error:any){if(error?.name==="AbortError"||fromCurrentPage)throw error;references=[];ztoolkit.log("PDF failed; trying structured sources",safeProviderAttempt(String(error?.message||error)));}
        }
        if (!task.isCurrent()) return;
        const result=preferCachedReferences(normalizeReferenceResult({references,source:'PDF',partial:Boolean(attachment&&this.utils.PDF.getDiagnostics(attachment)?.scanLimited)}),fromCurrentPage?undefined:readCachedReferenceResult(cached,signature),getString('cards-cached-offline'));
        references=result.references;partial=Boolean(result.partial);resultSource=this.referenceDescription(result);
        sourceEvidence={source:result.source,count:result.references.length,expected:result.expected,partial:Boolean(result.partial),retained:result.retained,attempts:result.attempts,status:result.status,latestAttempt:result.latestAttempt};
        if(references.length&&!result.retained&&signature&&!fromCurrentPage&&this.mayPersist(result))await this.storage.set(item,key,cacheReferenceResult(result,signature));
      }
      // An empty/scanned/missing PDF should not require a manual source switch.
      if(!references?.length&&!fromCurrentPage){
        const result=await this.smartReferences(item,undefined,task,false,false,label);
        if(!task.isCurrent())return;
        if(result.status==="unavailable"&&!result.references.length){showUnavailable(result);throw new Error(result.attempts?.join("; ")||"Reference providers unavailable");}
        references=result.references;resultSource=this.referenceDescription(result);
        sourceEvidence={source:result.source,count:result.references.length,expected:result.expected,partial:Boolean(result.partial),retained:result.retained,attempts:result.attempts,status:result.status,latestAttempt:result.latestAttempt};
        label.title=(result.attempts||[]).map(safeProviderAttempt).join("\n");
      }
    } else {
      const key = "References-API";
      const cached=await this.storage.getAsync(item,key);
      const previous=!fromCurrentPage ? readCachedReferenceResult(cached,signature) : undefined;
      if(!task.isCurrent())return;
      let result:ReferenceResult;
      if(local&&previous)result=previous;
      else {
        const api=this.utils.API;
        result=await retrieveReferenceList([
          {name:"Online",run:()=>this.onlineReferences(item,task,label)},
          {name:"PDF fallback",run:async()=>{
            const attachment=await this.pdfAttachment(item,reader);
            if(!attachment||!task.isCurrent())return;
            const refs=await this.utils.PDF.getReferences(attachment,fromCurrentPage,{signal:task.signal,pageIndex:task.pageIndex,notify:false});
            return {references:refs,source:"PDF fallback",partial:this.utils.PDF.getDiagnostics(attachment)?.scanLimited};
          }}
        ],task.signal,source=>{if(task.isCurrent())label.textContent=`${getString("relatedbox-loading")} ${source}`;});
        if(!task.isCurrent())return;
        result=preferCachedReferences(result,previous,getString("cards-cached-offline"));
        if(result.references.length&&!result.retained&&!fromCurrentPage&&this.mayPersist(result))await this.storage.set(item,key,cacheReferenceResult(result,signature));
      }
      if(result.status==="unavailable"&&!result.references.length){showUnavailable(result);throw new Error(result.attempts?.join("; ")||"Reference providers unavailable");}
      references=result.references;resultSource=this.referenceDescription(result);
      sourceEvidence={source:result.source,count:result.references.length,expected:result.expected,partial:Boolean(result.partial),retained:result.retained,attempts:result.attempts,status:result.status,latestAttempt:result.latestAttempt};
      label.title=(result.attempts||[]).map(safeProviderAttempt).join("\n");
    }

    if (!task.isCurrent()) return;
    if (!references) {
      references = [];
    }
    references=references.map(referenceData);
    if(!references.length && (panel as any).references?.length){
      label.textContent=`${(panel as any).references.length} · ${getString("cards-refresh-empty-kept")}`;
      return;
    }
    const referenceNum = references.length;
    if(sourceEvidence)setSourceEvidence(sourceEvidence);
    panel.setAttribute("data-refflow-result-type",literatureType);
    // @ts-ignore
    panel.references = references;

    const currentSource = resultSource;
    panel.setAttribute("data-refflow-result-source",resultSource);
    const refreshBtn = panel.querySelector("#refresh-button") as HTMLButtonElement;
    if (refreshBtn) {
      const tooltipTpl = getString("relatedbox-source-tooltip") || "当前来源: { $source } (点击切换模式，长按强制更新)";
      refreshBtn.title = tooltipTpl.replace("{ $source }", currentSource);
    }

    if (referenceNum === 0) {
      label.textContent = `${getString(["Auto","Web","PDF"].includes(source)?"cards-auto-empty":"relatedbox-empty")} [${currentSource}]`;
      return;
    }
    await this.sortReferences(panel as any);
    if(!task.isCurrent())return;
    (panel as any)._setL10nArgs?.(JSON.stringify({count:referenceNum}));
    label.innerText = `${referenceNum} ${getString("relatedbox-number-label")} [${currentSource}]`;
    (panel as any)._cards?.updateStatus();
  }

  public async sortReferences(panel:HTMLElement):Promise<void> {
    const refs:ItemBaseInfo[]=(panel as any).references||[],displayed=[...refs];
    const sort=Zotero.Prefs.get(`${config.addonRef}.sortBy`);
    if(sort==="Recency")displayed.sort((a,b)=>Number(b.year||0)-Number(a.year||0));
    if(sort==="Cited Count")displayed.sort((a,b)=>Number(b.citationCount||0)-Number(a.citationCount||0));
    const identity=panel.getAttribute('data-refflow-item-id');
    // A committed list outlives the fetching task. Lazy matching must remain
    // valid after the task has been removed from ReferenceTasks.
    await (panel as any)._cards?.render(displayed,()=>panel.isConnected&&panel.getAttribute('data-refflow-item-id')===identity&&(panel as any).references===refs);
    (panel as any)._cards?.updateStatus();
  }

  public showTipUI(refRect: Rect, reference: ItemInfo, position: string, idText?: string, localOnly: boolean = false, win: Window = window) {
    let toTimeInfo = (t: string) => {
      if (!t) { return undefined }
      let info = (new Date(t)).toString().split(" ")
      return `${info[1]} ${info[3]}`
    }
    this.tips.get(win)?.clear();
    let tipUI = new TipUI(this.utils, win)
    this.tips.set(win,tipUI);
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
        this.utils.API.getArXivInfo(reference.identifiers.arXiv,tipUI.signal)
      ]
      prefIndex = parseInt(Zotero.Prefs.get(`${config.addonRef}.${according}InfoIndex`) as string)
    } else if (reference?.identifiers.DOI) {
      according = "DOI"
      coroutines = [
        getDefalutInfoByReference(),
        this.utils.API.getDOIInfoBySemanticscholar(reference.identifiers.DOI,tipUI.signal),
        this.utils.API.getDOIInfoByCrossref(reference.identifiers.DOI,tipUI.signal)
      ]
      prefIndex = parseInt(Zotero.Prefs.get(`${config.addonRef}.${according}InfoIndex`) as string)
    } else {
      according = "Title";
      const searchTitle = reference.title || reference.text || "";
      coroutines = [
        getDefalutInfoByReference(),
        this.utils.API.semanticScholar.byTitle(searchTitle,reference.authors?.[0],reference.year,tipUI.signal).then(paper=>paper?this.utils.API.semanticScholar.toInfo(paper):undefined),
        this.utils.API.getTitleInfoByCrossref(searchTitle,reference.authors?.[0],reference.year,tipUI.signal),
        this.utils.API.openAlex.searchWorkByTitle(searchTitle,reference.authors?.[0],reference.year,tipUI.signal).then(oa => {
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
        this.utils.API.getTitleInfoByCNKI(searchTitle,tipUI.signal)
      ];
      prefIndex = parseInt(Zotero.Prefs.get(`${config.addonRef}.${according}InfoIndex`) as string);
    }
    if(!Number.isInteger(prefIndex)||prefIndex<0||prefIndex>=coroutines.length)prefIndex=0;
    // Attach rejection handlers immediately; the UI timers may be deferred in
    // a background window while cancelled provider promises settle earlier.
    coroutines=coroutines.map(promise=>promise.catch(error=>{if(error?.name!=="AbortError")ztoolkit.log("Tip coroutine error",error);return undefined;}));
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
      globalThis.setTimeout(async () => {
        let info = await coroutines[i].catch(e => {
          ztoolkit.log("Tip coroutine error:", e);
          return undefined;
        });
        if (!info || tipUI.signal.aborted || win.closed) { return }
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
