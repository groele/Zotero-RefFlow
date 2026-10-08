import CitationVerifier from "./verifier";
import Utils from "./utils";

export interface BatchImportOptions {
  downloadOA?: boolean;
  createSubCollection?: boolean;
  createManifestNote?: boolean;
  translatorTimeoutMs?: number;
  collections?: number[];
}
export interface BatchImportResult {
  batchId: string; total: number; importedCount: number; existingCount: number; failedCount: number;
  downloadCount: number; downloadFailedCount: number; subCollection?: any;
}
interface BatchRecord {
  version: 1; parentID: number; libraryID: number; createdIDs: number[]; noteID?: number; collectionID?: number;
  relations: Array<{id:number;parentAdded:boolean;itemAdded:boolean}>;
  memberships: Array<{id:number;collectionID:number}>;
  attachments: Array<{id:number;parentID:number}>;
}

export class BatchImporter {
  private static _utils?:Utils;
  private static get utils(){return this._utils ??= new Utils();}
  private static queues=new Map<number,Promise<any>>();
  private static sequence=0;

  public static generateBatchId(): string {
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

  private static async translatedMetadata(doi:string,timeoutMs:number):Promise<any|undefined> {
    let timer:any;
    // Translator results are metadata only. A late result cannot save an extra
    // item after the timeout has already caused the fallback to save one.
    const job=(async()=>{
      const translate=new (Zotero as any).Translate.Search();translate.setIdentifier({DOI:doi});
      const translators=await translate.getTranslators();if(!translators?.length)return;
      translate.setTranslator(translators);
      return (await translate.translate({libraryID:false,saveAttachments:false}))?.[0];
    })();
    try {return await Promise.race([job,new Promise<undefined>(resolve=>{timer=window.setTimeout(()=>resolve(undefined),Math.max(1,timeoutMs));})]);}
    catch(error){ztoolkit.log("DOI metadata lookup failed",error);return undefined;}
    finally {window.clearTimeout(timer);}
  }

  private static makeItem(ref:ItemBaseInfo,metadata:any,libraryID:number):Zotero.Item {
    const native=Zotero as any;
    const candidateType=metadata?.itemType||ref.type||"journalArticle";
    const type=native.ItemTypes.getID(candidateType)?candidateType:"journalArticle";
    const item=new Zotero.Item(type);item.libraryID=libraryID;
    const data=metadata||{title:ref.title||ref.text||"Untitled",DOI:ref.identifiers?.DOI,date:ref.year,publicationTitle:ref.publicationVenue};
    for(const [field,value] of Object.entries(data)) {
      if(typeof value!=="string" && typeof value!=="number")continue;
      const fieldID=native.ItemFields.getID(field);
      if(fieldID && native.ItemFields.isValidForType(fieldID,item.itemTypeID)) item.setField(field as any,String(value));
    }
    if(!item.getField("title")) item.setField("title",ref.title||ref.text||"Untitled");
    if(ref.identifiers?.DOI && native.ItemFields.isValidForType(native.ItemFields.getID("DOI"),item.itemTypeID)) item.setField("DOI",ref.identifiers.DOI);
    const creators=metadata?.creators || (ref.authors||[]).map(name=>this.utils.splitCreator(name));
    if(creators.length)item.setCreators(creators);
    return item;
  }

  public static importAll(parent:Zotero.Item,refs:ItemBaseInfo[],options:BatchImportOptions={}):Promise<BatchImportResult> {
    return this.serial(parent.libraryID,()=>this.importBatch(parent,refs,{downloadOA:true,createSubCollection:true,createManifestNote:true,...options}));
  }

  private static async importBatch(parent:Zotero.Item,refs:ItemBaseInfo[],options:BatchImportOptions):Promise<BatchImportResult> {
    if(!parent?.id || !parent.isRegularItem() || parent.deleted)throw new Error("Select a saved, editable parent item");
    const library=(Zotero as any).Libraries.get(parent.libraryID);
    if(!library?.editable)throw new Error("This library is read-only");
    if(!refs.length)throw new Error("No references to import");
    const batchID=this.generateBatchId();
    const record:BatchRecord={version:1,parentID:parent.id,libraryID:parent.libraryID,createdIDs:[],relations:[],memberships:[],attachments:[]};
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
          if(col?.libraryID===parent.libraryID)collections.push(id);
        }
      }
      const seen=new Map<string,Zotero.Item>();
      const downloads=new Map<number,{url:string;item:Zotero.Item}>();
      for(let index=0;index<refs.length;index++) {
        const ref=refs[index];const doi=CitationVerifier.normalizeDOI(ref.identifiers?.DOI);
        const identity=doi?`doi:${doi}`:`title:${CitationVerifier.cleanTitle(ref.title||ref.text)}`;
        progress.changeLine({text:`${index+1} / ${refs.length}`,progress:100*(index+1)/Math.max(1,refs.length)});
        try {
          if(!doi && !(ref.title||ref.text)?.trim())throw new Error("Reference has no usable metadata");
          let item=seen.get(identity) || await this.utils.searchLibraryItem({...ref,_item:undefined},parent.libraryID);
          const isNew=!item;
          if(!item) {
            const metadata=doi?await this.translatedMetadata(doi,options.translatorTimeoutMs??10000):undefined;
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
              if(target.id!==parent.id) {
                const parentAdded=!parent.relatedItems.includes(target.key),itemAdded=!target.relatedItems.includes(parent.key);
                if(parentAdded)parent.addRelatedItem(target);if(itemAdded)target.addRelatedItem(parent);
                if(parentAdded||itemAdded)record.relations.push({id:target.id,parentAdded,itemAdded});
              }
              await target.save();this.storeRecord(parent,batchID,record);await parent.save();
            });
          } catch(error) {
            record.createdIDs.length=oldCreated;record.relations.length=oldRelations;record.memberships.length=oldMemberships;
            await Promise.allSettled([(parent as any).reload(null,true),target.id?(target as any).reload(null,true):Promise.resolve()]);throw error;
          }
          if(isNew)result.importedCount++;else result.existingCount++;
          seen.set(identity,target);ref._item=target;
          if(options.downloadOA && ref.oaUrl && library.filesEditable && /^https?:\/\//i.test(ref.oaUrl) && !target.getAttachments().length)downloads.set(target.id,{url:ref.oaUrl,item:target});
        } catch(error) {result.failedCount++;ztoolkit.log("Reference import failed",error);}
      }
      if(options.createManifestNote) {
        await this.transaction(async()=>{
          const note=new Zotero.Item("note");note.libraryID=parent.libraryID;note.parentID=parent.id;
          note.setNote(this.manifestHTML(parent,refs,batchID));note.addTag(`refnexus:batch:${batchID}`);await note.save();
          record.noteID=note.id;this.storeRecord(parent,batchID,record);await parent.save();
        });
      }
      // Await downloads under the same library queue. Rollback cannot race a
      // background download that creates a new attachment after the batch ends.
      const queue=[...downloads.values()];
      const worker=async()=>{
        while(queue.length) {
          const task=queue.shift()!;
          try {
            const attachment=await Zotero.Attachments.importFromURL({url:task.url,parentItemID:task.item.id,libraryID:parent.libraryID,title:"Full Text PDF (Open Access)"});
            if(attachment){record.attachments.push({id:attachment.id,parentID:task.item.id});result.downloadCount++;}
          } catch(error) {result.downloadFailedCount++;ztoolkit.log("OA download failed",error);}
        }
      };
      if(queue.length){progress.changeLine({text:"Downloading open-access PDFs…"});await Promise.all([worker(),worker()]);await this.transaction(async()=>{this.storeRecord(parent,batchID,record);await parent.save();});}
      progress.changeHeadline("Import complete");progress.changeLine({text:`New: ${result.importedCount}; existing: ${result.existingCount}; failed: ${result.failedCount}`,type:result.failedCount?"fail":"success"});
      return result;
    } catch(error){progress.changeHeadline("Import stopped; completed changes can be rolled back");throw error;}
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

  private static async rollback(parent:Zotero.Item,batchID:string):Promise<number> {
    if(!/^ref(?:nexus)?_batch_[A-Za-z0-9_]+$/.test(batchID))return 0;
    if(!(Zotero as any).Libraries.get(parent.libraryID)?.editable)throw new Error("This library is read-only");
    const lines=String(parent.getField("extra")||"").split(/\r?\n/);
    if(!lines.some(line=>/^(?:refnexus_batch_parent|ref_batch_parent): /.test(line) && line.split(": ")[1]===batchID))return 0;
    const encoded=lines.find(line=>line.startsWith(this.recordPrefix(batchID)));
    if(!encoded)return this.rollbackLegacy(parent,batchID,lines);
    const record:BatchRecord=JSON.parse(encoded.slice(this.recordPrefix(batchID).length));
    if(record.version!==1 || record.parentID!==parent.id || record.libraryID!==parent.libraryID)throw new Error("Batch ownership does not match this parent item");
    const ids:number[]=[];
    for(const id of [...record.createdIDs,record.noteID||0,...record.attachments.map(a=>a.id)]) {
      if(!id || id===parent.id)continue;
      const item=await Zotero.Items.getAsync(id) as Zotero.Item;
      if(!item || item.libraryID!==parent.libraryID || item.deleted)continue;
      const attachment=record.attachments.find(a=>a.id===id);
      if(attachment ? item.isAttachment() && item.parentID===attachment.parentID : (item.isNote()?item.parentID===parent.id && item.getTags().some(tag=>tag.tag===`refnexus:batch:${batchID}`):String(item.getField("extra")||"").split(/\r?\n/).includes(this.marker(batchID))))ids.push(id);
    }
    await this.transaction(async()=>{
      for(const change of record.relations) {
        const item=await Zotero.Items.getAsync(change.id) as Zotero.Item;
        if(!item || item.libraryID!==parent.libraryID)continue;
        if(change.parentAdded)parent.removeRelatedItem(item);if(change.itemAdded)item.removeRelatedItem(parent);
        await item.save();
      }
      for(const change of record.memberships) {
        const item=await Zotero.Items.getAsync(change.id) as Zotero.Item;
        if(item && item.libraryID===parent.libraryID){item.removeFromCollection(change.collectionID);await item.save();}
      }
      if(ids.length)await Zotero.Items.trash(ids);
      parent.setField("extra",lines.filter(line=>line!==`refnexus_batch_parent: ${batchID}` && !line.startsWith(this.recordPrefix(batchID))).join("\n"));await parent.save();
      if(record.collectionID) {
        const col=await Zotero.Collections.getAsync(record.collectionID) as Zotero.Collection;
        if(col && col.libraryID===parent.libraryID && !col.hasChildItems() && !col.hasChildCollections())await col.erase();
      }
    });
    this.utils.clearLibraryItemCache();return ids.length;
  }

  /** Old journals identify created items but cannot prove which old relations were added. */
  private static async rollbackLegacy(parent:Zotero.Item,batchID:string,lines:string[]):Promise<number> {
    const search:any=new Zotero.Search();search.libraryID=parent.libraryID;search.addCondition("extra","contains",this.marker(batchID));
    const items=await (Zotero.Items as any).getAsync(await search.search()) as Zotero.Item[];
    const ids=items.filter(item=>item && item.id!==parent.id && item.libraryID===parent.libraryID && !item.deleted && item.isRegularItem() && String(item.getField("extra")||"").split(/\r?\n/).includes(this.marker(batchID))).map(item=>item.id);
    if(ids.length)await Zotero.Items.trashTx(ids);
    parent.setField("extra",lines.filter(line=>!line.endsWith(`: ${batchID}`) && !line.startsWith(`import_collection_${batchID}:`) && !line.startsWith(`import_related_existing_${batchID}:`)).join("\n"));await parent.saveTx();
    this.utils.clearLibraryItemCache();return ids.length;
  }
}
export default BatchImporter;
