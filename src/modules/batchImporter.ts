import CitationVerifier from "./verifier";
import Utils from "./utils";
import {workIdentity} from './workIdentity';
import {BatchRecord,metadataFingerprint,usesItem,needsRelation,needsMembership} from './batchOwnership';

export interface BatchImportOptions {
  downloadOA?: boolean;
  createSubCollection?: boolean;
  createManifestNote?: boolean;
  translatorTimeoutMs?: number;
  collections?: number[];
  relatedParents?: Zotero.Item[];
  signal?:AbortSignal;
  budgetMs?:number;
}
export interface BatchImportResult {
  batchId: string; total: number; importedCount: number; existingCount: number; failedCount: number;
  downloadCount: number; downloadFailedCount: number; subCollection?: any;
  cancelled?:boolean;
}

export class BatchImporter {
  private static _utils?:Utils;
  private static get utils(){return this._utils ??= new Utils();}
  public static setUtils(utils:Utils){this._utils=utils;}
  private static queues=new Map<number,Promise<any>>();
  private static sequence=0;
  public static lastRollback={retainedIDs:[] as number[]};
  private static sessions=new Map<AbortController,number>();
  private static jobs=new Set<Promise<BatchImportResult>>();
  public static cancelImports(parentID?:number){for(const [controller,id] of this.sessions)if(parentID===undefined||id===parentID)controller.abort();}
  public static async shutdown(){this.cancelImports();await Promise.allSettled([...this.jobs]);}
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

  private static transaction<T>(job:()=>Promise<T>):Promise<T> {return (Zotero as any).DB.executeTransaction(job);}
  private static escape(value:any):string {return String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]!));}
  private static marker(batchID:string):string {return `import_batch: ${batchID}`;}
  private static recordPrefix(batchID:string):string {return `refnexus_record_${batchID}: `;}
  private static storeRecord(parent:Zotero.Item,batchID:string,record:BatchRecord):void {
    const lines=String(parent.getField("extra")||"").split(/\r?\n/).filter(line=>!line.startsWith(this.recordPrefix(batchID)));
    if(!lines.includes(`refnexus_batch_parent: ${batchID}`)) lines.push(`refnexus_batch_parent: ${batchID}`);
    lines.push(this.recordPrefix(batchID)+JSON.stringify(record));
    parent.setField("extra",lines.filter(Boolean).join("\n"));
  }

  private static async translatedMetadata(doi:string,timeoutMs:number,signal?:AbortSignal):Promise<any|undefined> {
    let timer:any;
    let stop:()=>void=()=>{};
    // Translator results are metadata only. A late result cannot save an extra
    // item after the timeout has already caused the fallback to save one.
    const job=(async()=>{
      const translate=new (Zotero as any).Translate.Search();translate.setIdentifier({DOI:doi});
      const translators=await translate.getTranslators();if(!translators?.length||signal?.aborted)return;
      translate.setTranslator(translators);
      const metadata=(await translate.translate({libraryID:false,saveAttachments:false}))?.[0];
      const returned=CitationVerifier.normalizeDOI(metadata?.DOI);
      if(returned&&returned!==CitationVerifier.normalizeDOI(doi)){ztoolkit.log("Ignoring conflicting translator DOI");return;}
      return metadata;
    })();
    try {return await Promise.race([job,new Promise<undefined>(resolve=>{stop=()=>resolve(undefined);signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();timer=globalThis.setTimeout(()=>resolve(undefined),Math.max(1,timeoutMs));})]);}
    catch(error){ztoolkit.log("DOI metadata lookup failed",error);return undefined;}
    finally {globalThis.clearTimeout(timer);signal?.removeEventListener('abort',stop);}
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
    if(doi && native.ItemFields.isValidForType(native.ItemFields.getID("DOI"),item.itemTypeID)) item.setField("DOI",doi);
    const creators=Array.isArray(metadata?.creators)?metadata.creators:(ref.authors||[]).map(name=>this.utils.splitCreator(name));
    if(creators.length)item.setCreators(creators);
    return item;
  }

  public static importAll(parent:Zotero.Item,refs:ItemBaseInfo[],options:BatchImportOptions={}):Promise<BatchImportResult> {
    const controller=new AbortController(),stop=()=>controller.abort();options.signal?.addEventListener('abort',stop,{once:true});if(options.signal?.aborted)stop();
    const timer=globalThis.setTimeout(stop,Math.max(1,options.budgetMs??300000));this.sessions.set(controller,parent.id);
    const job=this.serial(parent.libraryID,()=>{this.checkStopped(controller.signal);return this.importBatch(parent,refs,{downloadOA:true,createSubCollection:true,createManifestNote:true,...options,signal:controller.signal});}).finally(()=>{
      globalThis.clearTimeout(timer);options.signal?.removeEventListener('abort',stop);this.sessions.delete(controller);this.jobs.delete(job);
    });this.jobs.add(job);return job;
  }

  private static async importBatch(parent:Zotero.Item,refs:ItemBaseInfo[],options:BatchImportOptions):Promise<BatchImportResult> {
    if(!parent?.id || !parent.isRegularItem() || parent.deleted)throw new Error("Select a saved, editable parent item");
    const library=(Zotero as any).Libraries.get(parent.libraryID);
    if(!library?.editable)throw new Error("This library is read-only");
    const relatedParents = [...new Map([parent,...(options.relatedParents || [])].map(item => [item.id,item])).values()];
    if (relatedParents.some(item => !item.id || item.deleted || !item.isRegularItem() || item.libraryID !== parent.libraryID)) {
      throw new Error("Graph origins must be saved regular items in one editable library");
    }
    if(!refs.length)throw new Error("No references to import");
    const batchID=this.generateBatchId();
    const record:BatchRecord={version:2,parentID:parent.id,libraryID:parent.libraryID,createdIDs:[],relations:[],memberships:[],attachments:[],uses:[],states:{}};
    const result:BatchImportResult={batchId:batchID,total:refs.length,importedCount:0,existingCount:0,failedCount:0,downloadCount:0,downloadFailedCount:0};
    const progress=new ztoolkit.ProgressWindow("Import references",{closeTime:-1}).createLine({text:`0 / ${refs.length}`,type:"default"}).show();
    const collections:number[]=[];
    this.utils.clearLibraryItemCache();
    try {
      await this.transaction(async()=>{this.storeRecord(parent,batchID,record);await parent.save();});
      if(options.createSubCollection) {
        await this.transaction(async()=>{
          const col:any=new Zotero.Collection();col.libraryID=parent.libraryID;
          col.name=`[Refs] ${String(parent.getField("title")||"Paper").slice(0,60)}`;
          col.parentID=parent.getCollections()[0]||false;await col.save();
          collections.push(col.id);record.collectionID=col.id;result.subCollection=col;
          this.storeRecord(parent,batchID,record);await parent.save();
        });
      } else {
        for(const id of options.collections||parent.getCollections()) {
          const col=await Zotero.Collections.getAsync(id);
          if(col && col.libraryID===parent.libraryID)collections.push(id);
        }
      }
      const seen=new Map<string,Zotero.Item>();
      const downloads=new Map<number,{url:string;item:Zotero.Item}>();
      for(let index=0;index<refs.length;index++) {
        this.checkStopped(options.signal);
        const ref=refs[index];const doi=CitationVerifier.normalizeDOI(ref.identifiers?.DOI);
        const identity=workIdentity(ref);
        progress.changeLine({text:`${index+1} / ${refs.length}`,progress:100*(index+1)/Math.max(1,refs.length)});
        try {
          if(!doi && !(ref.title||ref.text)?.trim())throw new Error("Reference has no usable metadata");
          let item=seen.get(identity) || await this.utils.searchLibraryItem({...ref,_item:undefined},parent.libraryID);
          const isNew=!item;
          if(!item) {
            const metadata=doi?await this.translatedMetadata(doi,options.translatorTimeoutMs??10000,options.signal):undefined;
            this.checkStopped(options.signal);
            item=this.makeItem(ref,metadata,parent.libraryID);
            const extra=String(item.getField("extra")||"");item.setField("extra",[extra,this.marker(batchID)].filter(Boolean).join("\n"));
          }
          const target=item;
          const oldCreated=record.createdIDs.length,oldRelations=record.relations.length,oldMemberships=record.memberships.length;
          try {
            await this.transaction(async()=>{
              if(isNew){await target.save();record.createdIDs.push(target.id);}
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
                if(origin.id!==parent.id)await origin.save();
              }
              await target.save();
              record.uses!.push({id:target.id,parents:relatedParents.map(origin=>origin.id),collections:[...collections]});
              if(isNew)record.states![target.id]={metadata:metadataFingerprint(target),collections:target.getCollections(),related:[...target.relatedItems]};
              this.storeRecord(parent,batchID,record);await parent.save();
            });
          } catch(error) {
            record.createdIDs.length=oldCreated;record.relations.length=oldRelations;record.memberships.length=oldMemberships;
            record.uses=record.uses!.filter(use=>use.id!==target.id);if(isNew)delete record.states![target.id];
            await Promise.allSettled([...relatedParents.map(origin => (origin as any).reload(null,true)),target.id?(target as any).reload(null,true):Promise.resolve()]);throw error;
          }
          if(isNew)result.importedCount++;else result.existingCount++;
          seen.set(identity,target);ref._item=target;
          if(options.downloadOA && ref.oaUrl && library.filesEditable && /^https?:\/\//i.test(ref.oaUrl) && !target.getAttachments().length)downloads.set(target.id,{url:ref.oaUrl,item:target});
        } catch(error:any) {if(error?.name==='AbortError')throw error;result.failedCount++;ztoolkit.log("Reference import failed",error);}
      }
      if(options.createManifestNote) {
        this.checkStopped(options.signal);
        await this.transaction(async()=>{
          const note=new Zotero.Item("note");note.libraryID=parent.libraryID;note.parentID=parent.id;
          note.setNote(this.manifestHTML(parent,refs,batchID));note.addTag(`refnexus:batch:${batchID}`);await note.save();
          record.noteID=note.id;record.noteState=metadataFingerprint(note);this.storeRecord(parent,batchID,record);await parent.save();
        });
      }
      // Await downloads under the same library queue. Rollback cannot race a
      // background download that creates a new attachment after the batch ends.
      const queue=[...downloads.values()];
      const worker=async()=>{
        while(queue.length) {
          if(options.signal?.aborted)return;
          const task=queue.shift()!;
          try {
            const attachment=await Zotero.Attachments.importFromURL({url:task.url,parentItemID:task.item.id,libraryID:parent.libraryID,title:"Full Text PDF (Open Access)"});
            if(attachment){record.attachments.push({id:attachment.id,parentID:task.item.id,metadata:metadataFingerprint(attachment)});result.downloadCount++;await this.transaction(async()=>{this.storeRecord(parent,batchID,record);await parent.save();});}
          } catch(error) {result.downloadFailedCount++;ztoolkit.log("OA download failed",error);}
        }
      };
      if(queue.length){progress.changeLine({text:"Downloading open-access PDFs…"});await Promise.all([worker(),worker()]);await this.transaction(async()=>{this.storeRecord(parent,batchID,record);await parent.save();});}
      this.checkStopped(options.signal);
      progress.changeHeadline("Import complete");progress.changeLine({text:`New: ${result.importedCount}; existing: ${result.existingCount}; failed: ${result.failedCount}`,type:result.failedCount?"fail":"success"});
      return result;
    } catch(error:any){progress.changeHeadline("Import stopped; completed changes can be rolled back");if(error?.name==='AbortError')return {...result,cancelled:true};throw error;}
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
    return this.serial(parent.libraryID,()=>this.rollback(parent,batchID));
  }

  private static async otherRecords(parent:Zotero.Item,batchID:string):Promise<Array<{owner:Zotero.Item;batchID:string;record:BatchRecord}>> {
    const search:any=new Zotero.Search();search.libraryID=parent.libraryID;search.addCondition('extra','contains','refnexus_record_');
    const owners=await (Zotero.Items as any).getAsync(await search.search()) as Zotero.Item[];
    const records:Array<{owner:Zotero.Item;batchID:string;record:BatchRecord}>=[];
    for(const owner of owners){if(owner.deleted)continue;
      for(const line of String(owner.getField('extra')||'').split(/\r?\n/)){
        const match=line.match(/^refnexus_record_(refnexus_batch_\w+): (.+)$/);if(!match||match[1]===batchID)continue;
        try{const value=JSON.parse(match[2]);if(![1,2].includes(value.version)||value.parentID!==owner.id||value.libraryID!==parent.libraryID||!Array.isArray(value.createdIDs)||!Array.isArray(value.relations)||!Array.isArray(value.memberships))throw new Error('Unsupported journal');records.push({owner,batchID:match[1],record:value});}
        catch{throw new Error('Cannot safely reconcile another import journal');}
      }
    }
    return records;
  }

  private static async rollback(parent:Zotero.Item,batchID:string):Promise<number> {
    this.lastRollback={retainedIDs:[]};
    if(!/^ref(?:nexus)?_batch_[A-Za-z0-9_]+$/.test(batchID))return 0;
    if(!(Zotero as any).Libraries.get(parent.libraryID)?.editable)throw new Error("This library is read-only");
    const lines=String(parent.getField("extra")||"").split(/\r?\n/);
    if(!lines.some(line=>/^(?:refnexus_batch_parent|ref_batch_parent): /.test(line) && line.split(": ")[1]===batchID))return 0;
    const encoded=lines.find(line=>line.startsWith(this.recordPrefix(batchID)));
    if(!encoded)return this.rollbackLegacy(parent,batchID,lines);
    const record:BatchRecord=JSON.parse(encoded.slice(this.recordPrefix(batchID).length));
    if(![1,2].includes(record.version) || record.parentID!==parent.id || record.libraryID!==parent.libraryID)throw new Error("Batch ownership does not match this parent item");
    const journals=await this.otherRecords(parent,batchID),others=journals.map(journal=>journal.record),retained=new Set<number>();
    for(const id of record.createdIDs){
      const item=await Zotero.Items.getAsync(id) as Zotero.Item;if(!item||item.deleted)continue;
      const state=record.states?.[id];
      const externalRelations=item.relatedItems.some(key=>!(state?.related||record.relations.filter(edge=>edge.id===id).map(edge=>{const origin=Zotero.Items.get(edge.parentID||parent.id);return origin?origin.key:undefined;})).includes(key));
      const ownAttachments=record.attachments.filter(row=>row.parentID===id).map(row=>row.id);
      const children=await (Zotero.Items as any).getAsync(item.getAttachments()) as Zotero.Item[];
      const annotated=children.some(child=>(child as any).isFileAttachment?.()&&(child as any).getAnnotations().length);
      const editedAttachment=children.some(child=>{const owned=record.attachments.find(row=>row.id===child.id);return owned&&(!owned.metadata||metadataFingerprint(child)!==owned.metadata);});
      if(!state||others.some(other=>usesItem(other,id))||externalRelations||
        state&&(metadataFingerprint(item)!==state.metadata||item.getCollections().some(col=>!state.collections.includes(col)))||
        item.getAttachments().some(child=>!ownAttachments.includes(child))||item.getNotes().length||annotated||editedAttachment)retained.add(id);
    }
    this.lastRollback={retainedIDs:[...retained]};
    const ids:number[]=[];
    for(const id of [...record.createdIDs,record.noteID||0,...record.attachments.map(a=>a.id)]) {
      if(!id || id===parent.id)continue;
      const item=await Zotero.Items.getAsync(id) as Zotero.Item;
      if(!item || item.libraryID!==parent.libraryID || item.deleted)continue;
      const attachment=record.attachments.find(a=>a.id===id);
      if(attachment&&((item as any).isFileAttachment?.()&&(item as any).getAnnotations().length||!attachment.metadata||metadataFingerprint(item)!==attachment.metadata))retained.add(id);
      if(item.isNote()&&(!record.noteState||metadataFingerprint(item)!==record.noteState))retained.add(id);
      if(retained.has(id)||attachment&&retained.has(attachment.parentID))continue;
      if(attachment ? item.isAttachment() && item.parentID===attachment.parentID : (item.isNote()?item.parentID===parent.id && item.getTags().some(tag=>tag.tag===`refnexus:batch:${batchID}`):String(item.getField("extra")||"").split(/\r?\n/).includes(this.marker(batchID))))ids.push(id);
    }
    await this.transaction(async()=>{
      for(const change of record.relations) {
        const item=await Zotero.Items.getAsync(change.id) as Zotero.Item;
        const origin = change.parentID && change.parentID !== parent.id ? await Zotero.Items.getAsync(change.parentID) as Zotero.Item : parent;
        if(!item || item.libraryID!==parent.libraryID || !origin || origin.libraryID!==parent.libraryID)continue;
        const shared=journals.find(journal=>needsRelation(journal.record,item.id,origin.id));
        if(shared){
          const edge=shared.record.relations.find(edge=>edge.id===item.id&&(edge.parentID||shared.record.parentID)===origin.id);
          if(edge){edge.parentAdded ||=change.parentAdded;edge.itemAdded ||=change.itemAdded;}else shared.record.relations.push({...change,parentID:origin.id});
          this.storeRecord(shared.owner,shared.batchID,shared.record);await shared.owner.save();continue;
        }
        if(change.parentAdded)origin.removeRelatedItem(item);if(change.itemAdded)item.removeRelatedItem(origin);
        if(origin.id!==parent.id)await origin.save();
        await item.save();
      }
      for(const change of record.memberships) {
        const item=await Zotero.Items.getAsync(change.id) as Zotero.Item;
        if(item && item.libraryID===parent.libraryID){
          const shared=journals.find(journal=>needsMembership(journal.record,item.id,change.collectionID));
          if(shared){if(!shared.record.memberships.some(row=>row.id===item.id&&row.collectionID===change.collectionID))shared.record.memberships.push(change);this.storeRecord(shared.owner,shared.batchID,shared.record);await shared.owner.save();}
          else{item.removeFromCollection(change.collectionID);await item.save();}
        }
      }
      if(ids.length)await Zotero.Items.trash(ids);
      parent.setField("extra",String(parent.getField('extra')||'').split(/\r?\n/).filter(line=>line!==`refnexus_batch_parent: ${batchID}` && !line.startsWith(this.recordPrefix(batchID))).join("\n"));await parent.save();
      if(record.collectionID) {
        const col=await Zotero.Collections.getAsync(record.collectionID) as Zotero.Collection;
        if(col && col.libraryID===parent.libraryID && !col.hasChildItems() && !col.hasChildCollections())await col.erase();
      }
    });
    this.lastRollback={retainedIDs:[...retained]};
    this.utils.clearLibraryItemCache();return ids.length;
  }

  /** Old journals identify created items but cannot prove which old relations were added. */
  private static async rollbackLegacy(parent:Zotero.Item,batchID:string,lines:string[]):Promise<number> {
    const search:any=new Zotero.Search();search.libraryID=parent.libraryID;search.addCondition("extra","contains",this.marker(batchID));
    const items=await (Zotero.Items as any).getAsync(await search.search()) as Zotero.Item[];
    const ids=items.filter(item=>item && item.id!==parent.id && item.libraryID===parent.libraryID && !item.deleted && item.isRegularItem() && String(item.getField("extra")||"").split(/\r?\n/).includes(this.marker(batchID))).map(item=>item.id);
    // A legacy marker proves creation but carries no baseline for later user
    // edits or reuse. Keep these objects rather than guessing exclusive ownership.
    this.lastRollback={retainedIDs:ids};
    parent.setField("extra",lines.filter(line=>!line.endsWith(`: ${batchID}`) && !line.startsWith(`import_collection_${batchID}:`) && !line.startsWith(`import_related_existing_${batchID}:`)).join("\n"));await parent.saveTx();
    this.utils.clearLibraryItemCache();return 0;
  }
}
export default BatchImporter;
