import batchJournal,{JournalCommitPendingError} from "./batchJournal";
import BatchRollback from "./batchRollback";
import CitationVerifier from "./verifier";
import Utils from "./utils";
import {workIdentity,getItemDOI,applyItemDOI} from './workIdentity';
import {BatchRecord,metadataFingerprint,usesItem,needsRelation,needsMembership,validateBatchRecord,collectionState,sameCollectionState} from './batchOwnership';
import {ImportError, ImportErrorCode, importText, importSummaryText} from './importErrors';
import {safeProviderAttempt} from './referenceSourceDetails';

export interface BatchImportOptions {
  downloadOA?: boolean;
  /** Automatically attempt federated resolution (Crossref/OpenAlex/SemanticScholar) for references without DOI. */
  resolveMissingDOI?: boolean;
  /** Explicit opt-in for callers importing a reference that has no DOI. */
  allowMetadataWithoutDOI?:boolean;
  createSubCollection?: boolean;
  createManifestNote?: boolean;
  translatorTimeoutMs?: number;
  collections?: number[];
  relatedParents?: Zotero.Item[];
  signal?:AbortSignal;
  budgetMs?:number;
  /** Runtime-only cancellation scope; never persisted in the batch journal. */
  owner?:object;
}
export interface BatchImportResult {
  batchId: string; total: number; importedCount: number; existingCount: number; failedCount: number;
  downloadCount: number; downloadFailedCount: number; subCollection?: any;
  cancelled?:boolean;
  failures: Array<{index:number;doi:string;title:string;reason:string;code?:ImportErrorCode}>;
}

export class BatchImporter {
  private static _utils?:Utils;
  private static get utils(){return this._utils ??= new Utils();}
  public static setUtils(utils:Utils){this._utils=utils;BatchRollback.setUtils(utils);}
  private static queues=new Map<number,Promise<any>>();
  private static sequence=0;
  public static get lastRollback(){return BatchRollback.lastRollback;}
  public static set lastRollback(val:{retainedIDs:number[]}){BatchRollback.lastRollback=val;}
  private static sessions=new Map<AbortController,{parentID:number;owner?:object}>();
  private static jobs=new Set<Promise<BatchImportResult>>();
  public static cancelImports(parentID?:number,owner?:object){for(const [controller,session] of this.sessions)if((parentID===undefined||session.parentID===parentID)&&(!owner||session.owner===owner||parentID!==undefined&&!session.owner))controller.abort();}
  public static async shutdown(){this.cancelImports();await Promise.allSettled([...this.jobs]);await batchJournal.flush();}
  private static checkStopped(signal?:AbortSignal){if(signal?.aborted){const error=new Error('Import stopped; completed changes remain available for batch rollback');error.name='AbortError';throw error;}}

  public static generateBatchId(): string {
    // Keep the persisted journal format so RefFlow can undo existing RefNexus batches.
    const date=new Date();const pad=(n:number,w=2)=>String(n).padStart(w,"0");
    return `refnexus_batch_${date.getFullYear()}${pad(date.getMonth()+1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}_${pad(date.getMilliseconds(),3)}_${++this.sequence}`;
  }

  private static serial<T>(libraryID:number,job:()=>Promise<T>):Promise<T> {
    const task=(this.queues.get(libraryID)||Promise.resolve()).catch(()=>{}).then(job);
    this.queues.set(libraryID,task);
    task.then(()=>{if(this.queues.get(libraryID)===task)this.queues.delete(libraryID);},()=>{if(this.queues.get(libraryID)===task)this.queues.delete(libraryID);});
    return task;
  }

  private static transaction<T>(libraryID:number,job:()=>Promise<T>):Promise<T> {return batchJournal.transaction(job,libraryID);}
  private static escape(value:any):string {return String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]!));}
  private static marker(batchID:string):string {return BatchRollback.marker(batchID);}
  private static recordPrefix(batchID:string):string {return BatchRollback.recordPrefix(batchID);}
  private static async storeRecord(parent:Zotero.Item,batchID:string,record:BatchRecord) {await batchJournal.put(parent,batchID,record);}

  private static async migrateRecords(libraryID:number,parent?:Zotero.Item,signal?:AbortSignal){
    return BatchRollback.migrateRecords(libraryID,parent,signal);
  }
  public static async migrateLegacy(parent:Zotero.Item){
    return BatchRollback.migrateLegacy(parent);
  }
  public static async latestBatchID(parent:Zotero.Item):Promise<string|undefined>{
    return BatchRollback.latestBatchID(parent);
  }

  private static async translatedMetadata(doi:string,timeoutMs:number,signal?:AbortSignal):Promise<any> {
    let timer:any;
    let stop:()=>void=()=>{};
    let active=true;
    const checkActive=()=>{this.checkStopped(signal);if(!active){const error=new Error('DOI lookup is no longer active');error.name='AbortError';throw error;}};
    this.checkStopped(signal);
    // Metadata-only translation leaves creation and rollback in our transaction.
    // A late translator result never writes an item after cancellation/timeout.
    const job=(async()=>{
      const translate=new (Zotero as any).Translate.Search();translate.setIdentifier({DOI:doi});
      const translators=await translate.getTranslators();checkActive();
      if(!translators?.length)throw new ImportError('translator','No Zotero DOI translator available; update translators and retry');
      translate.setTranslator(translators);
      const rows=await translate.translate({libraryID:false,saveAttachments:false});
      checkActive();
      const matches=Array.isArray(rows)?rows.filter(row=>CitationVerifier.normalizeDOI(row?.DOI)===doi):[];
      if(!matches.length)throw new ImportError('identity','Zotero DOI lookup returned missing or conflicting DOI; retry without importing this metadata');
      const metadata=matches.find(row=>typeof row?.title==='string'&&row.title.trim());
      if(!metadata)throw new ImportError('metadata','Zotero DOI lookup returned incomplete metadata; retry');
      return metadata;
    })();
    try {return await Promise.race([job,new Promise<never>((_resolve,reject)=>{
      stop=()=>{active=false;const error=new Error('DOI import cancelled');error.name='AbortError';reject(error);};
      signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();
      timer=globalThis.setTimeout(()=>{active=false;reject(new ImportError('timeout','Zotero DOI lookup timed out; check the connection and retry'));},Math.max(1,timeoutMs));
    })]);}
    catch(error:any){if(error?.name==='AbortError'||error instanceof ImportError)throw error;throw new ImportError('lookup',String(error?.message||error));}
    finally {active=false;globalThis.clearTimeout(timer);signal?.removeEventListener('abort',stop);}
  }

  private static makeItem(ref:ItemBaseInfo,metadata:any,libraryID:number):Zotero.Item {
    const native=Zotero as any;
    const candidateType=metadata?.itemType||ref.type||"journalArticle";
    const type=!["attachment","note","annotation"].includes(candidateType)&&native.ItemTypes.getID(candidateType)?candidateType:"journalArticle";
    const doi=CitationVerifier.normalizeDOI(ref.identifiers?.DOI);
    const item=new Zotero.Item(type);item.libraryID=libraryID;
    const data={title:ref.title||ref.text||"Untitled",DOI:doi,date:ref.year,publicationTitle:ref.publicationVenue,
      volume:ref.volume,issue:ref.issue,pages:ref.pages,url:ref.url,publisher:ref.publisher,place:ref.place,
      ...(metadata||{})};
    for(const [field,value] of Object.entries(data)) {
      if(typeof value!=="string" && typeof value!=="number")continue;
      const fieldID=native.ItemFields.getID(field);
      if(fieldID && native.ItemFields.isValidForType(fieldID,item.itemTypeID)) item.setField(field as any,String(value));
    }
    if(!item.getField("title")) item.setField("title",ref.title||ref.text||"Untitled");
    if(doi) applyItemDOI(item,doi);
    const creators=Array.isArray(metadata?.creators)?metadata.creators:(ref.authors||[]).map(name=>this.utils.splitCreator(name));
    if(creators.length)item.setCreators(creators);
    return item;
  }

  public static importAll(parent:Zotero.Item,refs:ItemBaseInfo[],options:BatchImportOptions={}):Promise<BatchImportResult> {
    // Freeze the operation's destination and source evidence at invocation.
    const originalRefs=[...refs];
    refs=refs.map(ref=>({...ref,identifiers:{...ref.identifiers},authors:[...(ref.authors||[])]}));
    options={...options,collections:[...new Set(options.collections??parent.getCollections?.()??[])],relatedParents:options.relatedParents?[...options.relatedParents]:undefined};
    const controller=new AbortController(),stop=()=>controller.abort();options.signal?.addEventListener('abort',stop,{once:true});if(options.signal?.aborted)stop();
    const timer=globalThis.setTimeout(stop,Math.max(1,options.budgetMs??300000));this.sessions.set(controller,{parentID:parent.id,owner:options.owner});
    const job=this.serial(parent.libraryID,()=>this.importBatch(parent,refs,{downloadOA:true,createSubCollection:true,createManifestNote:true,...options,signal:controller.signal})).then(result=>{refs.forEach((ref,index)=>{if(ref._item)originalRefs[index]._item=ref._item;if(ref.identifiers?.DOI&&!originalRefs[index].identifiers?.DOI){originalRefs[index].identifiers={...originalRefs[index].identifiers,DOI:ref.identifiers.DOI};}});return result;}).finally(()=>{
      globalThis.clearTimeout(timer);options.signal?.removeEventListener('abort',stop);this.sessions.delete(controller);this.jobs.delete(job);
    });this.jobs.add(job);return job;
  }

  private static async importBatch(parent:Zotero.Item,refs:ItemBaseInfo[],options:BatchImportOptions):Promise<BatchImportResult> {
    if(!parent?.id || !parent.isRegularItem() || parent.deleted)throw new ImportError('destination',"Select a saved, editable parent item");
    const library=(Zotero as any).Libraries.get(parent.libraryID);
    if(!library?.editable)throw new ImportError('destination',"This library is read-only");
    const relatedParents = [...new Map([parent,...(options.relatedParents || [])].map(item => [item.id,item])).values()];
    if (relatedParents.some(item => !item.id || item.deleted || !item.isRegularItem() || item.libraryID !== parent.libraryID)) {
      throw new ImportError('destination',"Graph origins must be saved regular items in one editable library");
    }
    if(!refs.length)throw new Error("No references to import");
    const batchID=this.generateBatchId();
    const record:BatchRecord={version:2,parentID:parent.id,libraryID:parent.libraryID,createdIDs:[],relations:[],memberships:[],attachments:[],uses:[],states:{}};
    const result:BatchImportResult={batchId:batchID,total:refs.length,importedCount:0,existingCount:0,failedCount:0,downloadCount:0,downloadFailedCount:0,failures:[]};
    const progress=new ztoolkit.ProgressWindow(importText('cards-importing-doi','Import references by DOI'),{closeTime:-1}).createLine({text:`0 / ${refs.length}`,type:"default"}).show();
    const collections:number[]=[];
    this.utils.clearLibraryItemCache();
    let initialized=false;
    const validateDestination=async()=>{
      this.checkStopped(options.signal);
      if(relatedParents.some(origin=>origin.deleted||!origin.isRegularItem()||origin.libraryID!==record.libraryID)||!(Zotero as any).Libraries.get(record.libraryID)?.editable)
        throw new ImportError('destination','Import destination is no longer editable; retry after selecting an available item');
      for(const id of options.collections||[]){
        const col=Number.isSafeInteger(id)&&id>0?await Zotero.Collections.getAsync(id):undefined;
        if(!col||col.deleted||col.libraryID!==record.libraryID)throw new ImportError('destination','Import collection is unavailable or belongs to another library; select a valid collection and retry');
      }
      this.checkStopped(options.signal);
    };
    // Runs inside the first successful item's transaction. A failed first save
    // must not leave an empty collection or a journal claiming a completed batch.
    const initialize=async()=>{if(initialized)return;
      if(options.createSubCollection) {
          const col:any=new Zotero.Collection();col.libraryID=parent.libraryID;
          col.name=`[Refs] ${String(parent.getField("title")||"Paper").slice(0,60)}`;
          col.parentID=options.collections?.[0]||false;await col.save({skipSelect:true});
          collections.push(col.id);record.collectionID=col.id;result.subCollection=col;
          record.collectionState=collectionState(col);
      } else {
        collections.push(...(options.collections||[]));
      }
      initialized=true;
    };
    try {
      this.checkStopped(options.signal);
      await this.transaction(parent.libraryID,async()=>{this.checkStopped(options.signal);await this.migrateRecords(parent.libraryID,parent,options.signal);this.checkStopped(options.signal);});
      const seen=new Map<string,Zotero.Item>();
      const failed=new Map<string,{reason:string;code?:ImportErrorCode}>();
      const downloads=new Map<number,{url:string;item:Zotero.Item}>();
      for(let index=0;index<refs.length;index++) {
        this.checkStopped(options.signal);
        const ref=refs[index];let doi=CitationVerifier.normalizeDOI(ref.identifiers?.DOI);
        const identity=workIdentity(ref);
        progress.changeLine({text:`${index+1} / ${refs.length}`,progress:100*(index+1)/Math.max(1,refs.length)});
        try {
          if(failed.has(identity)){const failure=failed.get(identity)!;throw failure.code?new ImportError(failure.code,failure.reason):new Error(failure.reason);}
          await validateDestination();
          let item=seen.get(identity) || await this.utils.searchLibraryItem({...ref,_item:undefined},parent.libraryID);
          let isNew=!item;
          if(!item) {
            if(!doi && options.resolveMissingDOI && (ref.title || ref.text)?.trim()) {
              const queryTitle = (ref.title || ref.text)!.trim();
              if (queryTitle.length >= 6) {
                try {
                  const resolved = await this.utils.API?.resolveWork(queryTitle, ref.authors?.[0], ref.year, options.signal);
                  const resolvedDoi = resolved?.doi || (resolved as any)?.DOI;
                  if (resolvedDoi) {
                    ref.identifiers = ref.identifiers || {};
                    ref.identifiers.DOI = resolvedDoi;
                    if (resolved && !ref.oaUrl && resolved.oaUrl) ref.oaUrl = resolved.oaUrl;
                    doi = CitationVerifier.normalizeDOI(resolvedDoi);
                  }
                } catch (e: any) {
                  if (e?.name === 'AbortError' || options.signal?.aborted) throw e;
                }
              }
            }
            if(!doi&&!options.allowMetadataWithoutDOI)throw new ImportError('no-doi','No DOI available; this reference was not imported. Add its identifier in Zotero manually');
            if(!doi&&!(ref.title||ref.text)?.trim())throw new Error('Reference has no usable metadata');
            progress.changeLine({text:`${index+1} / ${refs.length} · DOI: ${doi||'metadata'}`});
            const metadata=doi?await this.translatedMetadata(doi,options.translatorTimeoutMs??20000,options.signal):undefined;
            this.checkStopped(options.signal);
            item=this.makeItem(ref,metadata,parent.libraryID);
          }
          this.checkStopped(options.signal);
          if(parent.deleted||item.deleted||!(Zotero as any).Libraries.get(parent.libraryID)?.editable)throw new ImportError('destination','Import destination is no longer editable; retry after selecting an available item');
          let target=item;
          const before=JSON.parse(JSON.stringify(record)) as BatchRecord,wasInitialized=initialized;
          try {
            await this.transaction(parent.libraryID,async()=>{
              await validateDestination();
              // Recheck under the write transaction: another importer may have
              // saved the work during translation or while this transaction queued.
              if(isNew){
                const existing=await this.utils.searchLibraryItem({...ref,_item:undefined},parent.libraryID,true);
                if(existing){target=existing;isNew=false;}}
              this.checkStopped(options.signal);
              if(target.deleted||target.libraryID!==record.libraryID)throw new ImportError('destination','Matched item is no longer available in the target library');
              if(!isNew&&doi){const existingDOI=getItemDOI(target);if(existingDOI&&existingDOI!==doi)throw new ImportError('identity','Matched local item has a conflicting DOI');if(!existingDOI)applyItemDOI(target,doi);}
              await initialize();
              if(isNew){await target.save({skipSelect:true});record.createdIDs.push(target.id);}
              for(const colID of collections) {
                if(!target.getCollections().includes(colID)) {
                  target.addToCollection(colID);
                  if(!isNew)record.memberships.push({id:target.id,collectionID:colID});
                }
              }
              for (const origin of relatedParents) {
                if(target.id===origin.id)continue;
                const parentAdded=!origin.relatedItems.includes(target.key),itemAdded=!target.relatedItems.includes(origin.key);
                if(parentAdded)origin.addRelatedItem(target);if(itemAdded)target.addRelatedItem(origin);
                if(parentAdded||itemAdded)record.relations.push({id:target.id,parentID:origin.id,parentAdded,itemAdded});
                if(origin.id!==parent.id)await origin.save({skipSelect:true});
              }
              await target.save({skipSelect:true});
              record.uses!.push({id:target.id,parents:relatedParents.map(origin=>origin.id),collections:[...collections]});
              if(isNew)record.states![target.id]={metadata:metadataFingerprint(target),collections:target.getCollections(),related:[...target.relatedItems]};
              await this.storeRecord(parent,batchID,record);await parent.save({skipSelect:true});
            });
          } catch(error) {
            if(error instanceof JournalCommitPendingError)throw error;
            Object.assign(record,before);if(before.collectionID===undefined){delete record.collectionID;delete record.collectionState;}
            if(!wasInitialized){initialized=false;collections.length=0;delete result.subCollection;}
            await Promise.allSettled([...relatedParents,...(target.id?[target]:[])].map(origin=>Promise.resolve().then(()=>(origin as any).reload(null,true))));throw error;
          }
          if(isNew)result.importedCount++;else result.existingCount++;
          seen.set(identity,target);ref._item=target;
          if(options.downloadOA && ref.oaUrl && library.filesEditable && /^https?:\/\//i.test(ref.oaUrl) && !target.getAttachments().length)downloads.set(target.id,{url:ref.oaUrl,item:target});
        } catch(error:any) {if(error?.name==='AbortError'||error instanceof JournalCommitPendingError)throw error;result.failedCount++;const failure={reason:String(error?.message||error),code:error instanceof ImportError?error.code:undefined};failed.set(identity,failure);result.failures.push({index,doi:doi||"",title:ref.title||ref.text||"",...failure});ztoolkit.log("Reference import failed",safeProviderAttempt(String(error?.message||error)));}
      }
      if(options.createManifestNote && result.importedCount+result.existingCount>0) {
        this.checkStopped(options.signal);
        await this.transaction(parent.libraryID,async()=>{
          const note=new Zotero.Item("note");note.libraryID=parent.libraryID;note.parentID=parent.id;
          note.setNote(this.manifestHTML(parent,refs,batchID));note.addTag(`refnexus:batch:${batchID}`);await note.save({skipSelect:true});
          record.noteID=note.id;record.noteState=metadataFingerprint(note);await this.storeRecord(parent,batchID,record);await parent.save();
        });
      }
      // Await downloads under the same library queue. Rollback cannot race a
      // background download that creates a new attachment after the batch ends.
      const queue=[...downloads.values()];let downloadStopped=false;
      const worker=async()=>{
        while(queue.length) {
          if(options.signal?.aborted||downloadStopped)return;
          const task=queue.shift()!;
          try {
            const attachment=await Zotero.Attachments.importFromURL({url:task.url,parentItemID:task.item.id,libraryID:parent.libraryID,title:"Full Text PDF (Open Access)"});
            if(!attachment)throw new Error('The OA download returned no attachment');
            record.attachments.push({id:attachment.id,parentID:task.item.id,metadata:metadataFingerprint(attachment)});await this.transaction(parent.libraryID,async()=>{await this.storeRecord(parent,batchID,record);await parent.save();});result.downloadCount++;
          } catch(error) {if(error instanceof JournalCommitPendingError){downloadStopped=true;throw error;}result.downloadFailedCount++;ztoolkit.log("OA download failed",error);}
        }
      };
      if(queue.length){progress.changeLine({text:importText('cards-import-downloading','Downloading open-access PDFs…')});const completed=await Promise.allSettled([worker(),worker()]);const failure=completed.find(result=>result.status==='rejected');if(failure?.status==='rejected')throw failure.reason;await this.transaction(parent.libraryID,async()=>{await this.storeRecord(parent,batchID,record);await parent.save();});}
      this.checkStopped(options.signal);
      progress.changeHeadline(importText('cards-import-complete','Import complete'));progress.changeLine({text:importSummaryText(result),type:result.failedCount||result.downloadFailedCount?"fail":"success"});
      return result;
    } catch(error:any){progress.changeHeadline(importText('cards-import-cancelled','Import stopped; completed changes can be rolled back'));if(error?.name==='AbortError')return {...result,cancelled:true};throw error;}
    finally {progress.startCloseTimer(4000);this.utils.clearLibraryItemCache();}
  }

  private static manifestHTML(parent:Zotero.Item,refs:ItemBaseInfo[],batchID:string):string {
    const rows=refs.map(ref=>{
      const doi=CitationVerifier.normalizeDOI(ref.identifiers?.DOI);
      const link=doi?` <a href="https://doi.org/${this.escape(encodeURI(doi))}">DOI: ${this.escape(doi)}</a>`:"";
      return `<li>${this.escape((ref.authors||[]).join(", "))}. <em>${this.escape(ref.title||ref.text||"Untitled")}</em> (${this.escape(ref.year||"n.d.")})${link}${ref._item?"":" [not imported]"}</li>`;
    });
    return `<h1>Reference manifest</h1><p>${this.escape(parent.getField("title"))}</p><p>Batch: ${this.escape(batchID)}</p><ol>${rows.join("")}</ol>`;
  }

  public static rollbackBatch(parent:Zotero.Item,batchID:string):Promise<number> {
    return this.rollbackBatchDetailed(parent,batchID).then(result=>result.removed);
  }

  public static rollbackBatchDetailed(parent:Zotero.Item,batchID:string):Promise<{removed:number;retainedIDs:number[]}> {
    return this.serial(parent.libraryID,async()=>{
      const outcome={retainedIDs:[] as number[]};
      const removed=await (this as any).rollback(parent,batchID,outcome);
      return {removed,retainedIDs:[...outcome.retainedIDs]};
    });
  }

  private static async rollback(parent:Zotero.Item,batchID:string,outcome:{retainedIDs:number[]}):Promise<number> {
    return BatchRollback.rollback(parent,batchID,outcome);
  }
}
export default BatchImporter;
