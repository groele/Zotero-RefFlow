import {BatchRecord,validateBatchRecord} from "./batchOwnership";

interface JournalEntry {batchID:string;parentKey:string;record:BatchRecord;itemKeys:Record<string,string>;}
interface JournalFile {version:1;pending:boolean;entries:JournalEntry[];}
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));

/** Durable rollback evidence, deliberately separate from the evictable response cache. */
export class BatchJournal {
  private queue:Promise<unknown>=Promise.resolve();
  private draft?:JournalFile;
  private touched=new Set<Zotero.Item>();
  public track(item:Zotero.Item){this.touched.add(item);}
  public async flush(){await this.queue;}
  public get filename(){return PathUtils.join(Zotero.DataDirectory.dir,"refflow-batch-journal-v1.json");}
  private get io():any{return (Zotero.getMainWindow() as any).IOUtils;}
  private async load():Promise<JournalFile>{
    if(!await this.io.exists(this.filename))return {version:1,pending:false,entries:[]};
    const data=await this.io.readJSON(this.filename);
    if(data?.version!==1||typeof data.pending!=="boolean"||!Array.isArray(data.entries))throw new Error("RefFlow batch journal is unreadable; original file preserved");
    if(data.pending)throw new Error("RefFlow batch journal contains an interrupted transaction; preserve the file and resolve it before importing or undoing batches");
    const ids=new Set<string>();
    for(const entry of data.entries){
      if(!entry||typeof entry.parentKey!=="string"||!entry.parentKey||!/^ref(?:nexus)?_batch_[A-Za-z0-9_]+$/.test(entry.batchID)||!entry.itemKeys||typeof entry.itemKeys!=="object"||Array.isArray(entry.itemKeys))throw new Error("Malformed RefFlow batch journal");
      if(!Number.isSafeInteger(entry.record?.parentID)||entry.record.parentID<=0||!Number.isSafeInteger(entry.record?.libraryID)||entry.record.libraryID<=0)throw new Error("Malformed RefFlow batch owner");
      validateBatchRecord(entry.record,entry.record.parentID,entry.record.libraryID);
      const key=entry.record.libraryID+":"+entry.batchID;if(ids.has(key))throw new Error("Duplicate RefFlow batch journal");ids.add(key);
      for(const [id,key] of Object.entries(entry.itemKeys))if(!Number.isSafeInteger(Number(id))||Number(id)<=0||typeof key!=="string"||!key)throw new Error("Malformed RefFlow item identity");
    }
    return data;
  }
  private async write(data:JournalFile){await this.io.writeJSON(this.filename,data,{tmpPath:this.filename+".tmp"});}
  public transaction<T>(job:()=>Promise<T>):Promise<T>{
    const task=this.queue.catch(()=>{}).then(async()=>{
      const before=await this.load();this.draft=clone(before);this.touched.clear();let prepared=false,committed=false;
      try{
        const result=await (Zotero as any).DB.executeTransaction(async()=>{
          const result=await job();
          if(JSON.stringify(this.draft)!==JSON.stringify(before)){
            await this.write({...this.draft!,pending:true});prepared=true;
          }
          return result;
        });
        committed=true;
        if(prepared)await this.write({...this.draft!,pending:false});
        return result;
      }catch(error){
        // DB rollback restores items; restore the pre-transaction file as well.
        // A finalization failure leaves pending=true and blocks destructive reuse.
        if(prepared&&!committed)await this.write(before);
        if(!committed)await Promise.allSettled([...this.touched].map(item=>Promise.resolve().then(()=>(item as any).reload(null,true))));
        throw error;
      }finally{this.draft=undefined;}
    });
    this.queue=task;return task;
  }
  public async get(parent:Zotero.Item,batchID:string):Promise<BatchRecord|undefined>{
    const entry=this.draft!.entries.find(row=>row.batchID===batchID&&row.record.libraryID===parent.libraryID);
    if(!entry)return;
    if(entry.record.parentID!==parent.id||entry.parentKey!==parent.key)throw new Error("Batch ownership does not match this parent item");
    for(const [id,key] of Object.entries(entry.itemKeys)){
      const item=await Zotero.Items.getAsync(Number(id));if(item&&item.key!==key)throw new Error("Batch item identity changed; refusing rollback");
    }
    return clone(entry.record);
  }
  public all(libraryID:number){return this.draft!.entries.filter(row=>row.record.libraryID===libraryID).map(row=>({batchID:row.batchID,parentID:row.record.parentID}));}
  public async put(parent:Zotero.Item,batchID:string,record:BatchRecord){
    validateBatchRecord(record,parent.id,parent.libraryID);
    const itemKeys:Record<string,string>={};
    for(const id of new Set([parent.id,...record.createdIDs,...record.relations.flatMap(row=>[row.id,row.parentID||parent.id]),...record.attachments.map(row=>row.id),...record.memberships.map(row=>row.id),...(record.noteID?[record.noteID]:[])])){
      const item=await Zotero.Items.getAsync(id);if(item){itemKeys[id]=item.key;this.track(item);}
    }
    this.track(parent);
    const index=this.draft!.entries.findIndex(row=>row.batchID===batchID&&row.record.libraryID===parent.libraryID);
    if(index>=0){await this.get(parent,batchID);this.draft!.entries[index]={batchID,parentKey:parent.key,record:clone(record),itemKeys:{...this.draft!.entries[index].itemKeys,...itemKeys}};}
    else this.draft!.entries.push({batchID,parentKey:parent.key,record:clone(record),itemKeys});
  }
  public remove(parent:Zotero.Item,batchID:string){this.draft!.entries=this.draft!.entries.filter(row=>!(row.batchID===batchID&&row.record.libraryID===parent.libraryID&&row.record.parentID===parent.id));}
}
export default new BatchJournal();
