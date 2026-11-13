import { config } from "../../package.json";
import { initLocale, getString } from "../utils/locale";
import TipUI from "./tip";
import Utils from "./utils";
import LocalStorge from "./localStorage";
import CacheMaintenance, {cacheLimits, referenceSnapshotExpired} from "./cacheMaintenance";
import BatchImporter from "./batchImporter";
import ReferenceTasks, { type ReferenceTaskContext } from "./referenceTasks";
import type { ReferenceResult } from "./referenceRetrieval";
import { safeProviderAttempt } from "./referenceSourceDetails";
import { importErrorText } from "./importErrors";
import { cleanupSync, cleanupAsync } from "../utils/lifecycle";
import { addReferencePaneStyles } from "./referencePaneStyles";
import { showReferenceTipUI } from "./referenceTip";
import { runReferenceSettingsAction } from "./referenceSettingsAction";
import {
  importReferencesBatch,
  rollbackReferencesBatch
} from "./referenceBatchOperations";
import {
  syncCancelButton,
  resetReferencePane,
  cancelReferencePane,
  showTypeMenu,
  registerReferenceItemPane
} from "./referencePaneDOM";
import {
  getPdfAttachment,
  getPdfCacheSignature
} from "./referenceAttachment";
import {
  mayPersist,
  referenceDescription,
  onlineReferences,
  smartReferences,
  performReferences,
  refreshReferences,
  sortReferences
} from "./referencePipeline";

export default class Views {
  public utils!: Utils;
  public readonly referenceTasks = new ReferenceTasks();
  public readonly storage = new LocalStorge(config.addonRef,cacheLimits(),referenceSnapshotExpired);
  private cacheMaintenance = new CacheMaintenance(this.storage);
  private paneID?: string;
  private notifierID?: string;
  private disposed = false;
  private panes = new Set<HTMLElement>();
  private libraryTimer?: ReturnType<typeof globalThis.setTimeout>;
  private changedLibraries = new Set<number>();
  private unknownLibraryChange = false;
  private tips = new Map<Window, TipUI>();
  private localizationDocuments = new Set<Document>();
  private menus = new Set<Element>();
  private importJobs = new Map<string, { job: ReturnType<typeof BatchImporter.importAll>; refs: ItemBaseInfo[] }>();
  private importOwnerIDs = new WeakMap<object, number>();
  private importOwnerSequence = 0;
  private pendingImports = new WeakMap<Element, Map<number, number>>();

  public isDisposed(): boolean { return this.disposed; }
  public getPanes(): Set<HTMLElement> { return this.panes; }
  public getMenus(): Set<Element> { return this.menus; }
  public getImportJobs() { return this.importJobs; }
  public getPendingImports(): WeakMap<Element, Map<number, number>> { return this.pendingImports; }

  constructor() {
    initLocale();
    this.utils = new Utils();
    BatchImporter.setUtils(this.utils);
  }

  public async runSettingsAction(action: string): Promise<string> {
    return runReferenceSettingsAction(this, action);
  }

  public closeQuickMenus(): void {
    for (const body of this.panes) (body as any)._cards?.closeQuickMenu();
  }

  public updateSourceDetailsVisibility(): void {
    for (const body of this.panes) {
      const details = body.querySelector<HTMLDetailsElement>("#refflow-source-details");
      if (details) details.hidden = Zotero.Prefs.get(`${config.addonRef}.showSourceDetails`) === false || !details.childElementCount;
    }
  }

  public syncCancelButton(body: Element): void {
    syncCancelButton(this, body);
  }

  public settingsError(error: unknown): string {
    return safeProviderAttempt(importErrorText(error));
  }

  public attachWindow(win: Window) {
    this.attachDocument(win.document);
    if (!win.document.getElementById(`${config.addonRef}-style`)) this.addStyle(win.document);
  }

  public detachWindow(win: Window) {
    for (const menu of this.menus) {
      if (menu.ownerDocument === win.document) {
        cleanupSync(() => menu.remove());
        this.menus.delete(menu);
      }
    }
    cleanupSync(() => this.tips.get(win)?.clear());
    this.tips.delete(win);
    win.document.querySelectorAll(`item-pane-custom-section[data-pane$="-${config.addonRef}-references"] [data-type="body"]`).forEach((body) => {
      cleanupSync(() => BatchImporter.cancelImports(undefined, body));
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

  public addStyle(doc: Document = document) {
    addReferencePaneStyles(doc);
  }

  public async onInit() {
    this.registerReferenceItemPane();
    this.notifierID = Zotero.Notifier.registerObserver({
      notify: (_event: any, _type: any, ids: any[], extra: any) => {
        if (this.disposed) return;
        const libraries = new Set<number>();
        for (const id of ids || []) {
          const item = Zotero.Items.get(Number(id));
          const libraryID = item ? item.libraryID : Number(extra?.[id]?.libraryID);
          if (libraryID) libraries.add(libraryID);
          else this.unknownLibraryChange = true;
        }
        if (!ids?.length) this.unknownLibraryChange = true;
        libraries.forEach((id) => this.changedLibraries.add(id));
        this.utils.clearLibraryItemCache(this.unknownLibraryChange ? undefined : libraries);
        globalThis.clearTimeout(this.libraryTimer);
        this.libraryTimer = globalThis.setTimeout(() => {
          if (this.disposed) return;
          for (const body of this.panes) {
            const item = Zotero.Items.get(Number(body.getAttribute("data-refflow-item-id")));
            if (body.isConnected && (this.unknownLibraryChange || (item && this.changedLibraries.has(item.libraryID)))) {
              (body as any)._cards?.invalidateLibraryMatches();
            }
          }
          this.changedLibraries.clear();
          this.unknownLibraryChange = false;
        }, 100);
      }
    }, ["item"], config.addonRef);
  }

  private registerReferenceItemPane() {
    const registered = registerReferenceItemPane(this);
    if (registered) this.paneID = registered;
  }

  public resetReferencePane(body: Element): void {
    resetReferencePane(this, body);
  }

  public cancelReferencePane(body: Element): void {
    cancelReferencePane(this, body);
  }

  public typeMenu(body: HTMLElement, item?: Zotero.Item) {
    showTypeMenu(this, body, item);
  }

  public async shutdown(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    cleanupSync(() => globalThis.clearTimeout(this.libraryTimer));
    for (const menu of this.menus) cleanupSync(() => menu.remove());
    this.menus.clear();
    for (const body of this.panes) cleanupSync(() => (body as any)._cards?.dispose());
    this.panes.clear();
    for (const tip of this.tips.values()) cleanupSync(() => tip.clear());
    this.tips.clear();
    cleanupSync(() => this.referenceTasks.dispose());
    await cleanupAsync(() => BatchImporter.shutdown());
    cleanupSync(() => this.utils.API.requests.dispose());
    cleanupSync(() => this.utils.API.publisherReferences.dispose());
    const notifierID = this.notifierID, paneID = this.paneID;
    this.notifierID = this.paneID = undefined;
    if (notifierID) cleanupSync(() => Zotero.Notifier.unregisterObserver(notifierID));
    if (paneID) cleanupSync(() => Zotero.ItemPaneManager.unregisterSection(paneID));
    cleanupSync(() => this.cacheMaintenance.dispose());
    await cleanupAsync(() => this.storage.dispose());
    const enumerator = (globalThis as any).Services?.wm?.getEnumerator?.("");
    const windows = enumerator ? {
      *[Symbol.iterator]() {
        while (enumerator.hasMoreElements()) yield enumerator.getNext();
      }
    } : Zotero.getMainWindows();
    for (const win of windows) {
      cleanupSync(() => {
        win.document.getElementById(`${config.addonRef}-style`)?.remove();
      });
    }
    for (const doc of this.localizationDocuments) {
      cleanupSync(() => (doc as any).l10n?.removeResourceIds([`${config.addonRef}-addon.ftl`]));
    }
    this.localizationDocuments.clear();
  }

  public async importReferences(parent: Zotero.Item, refs: ItemBaseInfo[], options: any = {}) {
    return importReferencesBatch(this, parent, refs, options, {
      importJobs: this.importJobs,
      importOwnerIDs: this.importOwnerIDs,
      importOwnerSequence: this.importOwnerSequence,
      pendingImports: this.pendingImports,
      getPanes: () => this.panes,
      syncCancelButton: (body) => this.syncCancelButton(body),
      isDisposed: () => this.disposed
    });
  }

  public async rollbackReferences(parent: Zotero.Item, batchID: string) {
    return rollbackReferencesBatch(parent, batchID);
  }

  public async pdfAttachment(item: Zotero.Item, reader?: any): Promise<Zotero.Item | undefined> {
    return getPdfAttachment(item, reader);
  }

  public async pdfCacheSignature(item: Zotero.Item, reader?: any): Promise<string> {
    return getPdfCacheSignature(item, reader);
  }

  public mayPersist(result: ReferenceResult): boolean {
    return mayPersist(result);
  }

  public referenceDescription(result: ReferenceResult): string {
    return referenceDescription(result);
  }

  public async onlineReferences(item: Zotero.Item, task: ReferenceTaskContext, label: HTMLElement): Promise<ReferenceResult | undefined> {
    return onlineReferences(this, item, task, label);
  }

  public async smartReferences(
    item: Zotero.Item,
    reader: any,
    task: ReferenceTaskContext,
    includePDF: boolean,
    fromCurrentPage: boolean,
    label: HTMLElement,
    webFirst = false
  ): Promise<ReferenceResult> {
    return smartReferences(this, item, reader, task, includePDF, fromCurrentPage, label, webFirst);
  }

  public async performReferences(
    panel: XUL.TabPanel,
    local: boolean,
    fromCurrentPage: boolean,
    item: Zotero.Item,
    readerOverride: _ZoteroTypes.ReaderInstance | undefined,
    task: ReferenceTaskContext
  ) {
    return performReferences(this, panel, local, fromCurrentPage, item, readerOverride, task);
  }

  public async refreshReferences(
    panel: XUL.TabPanel,
    local: boolean = true,
    fromCurrentPage: boolean = false,
    toggleSource: boolean = false,
    itemOverride?: Zotero.Item,
    readerOverride?: _ZoteroTypes.ReaderInstance
  ) {
    return refreshReferences(this, panel, local, fromCurrentPage, toggleSource, itemOverride, readerOverride);
  }

  public async sortReferences(panel: HTMLElement): Promise<void> {
    return sortReferences(panel);
  }

  public showTipUI(
    refRect: Rect,
    reference: ItemInfo,
    position: string,
    idText?: string,
    localOnly: boolean = false,
    win: Window = window
  ) {
    return showReferenceTipUI(refRect, reference, position, idText, localOnly, win, {
      utils: this.utils,
      tips: this.tips
    });
  }
}
