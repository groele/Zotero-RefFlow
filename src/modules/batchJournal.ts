import {BatchRecord,validateBatchRecord} from "./batchOwnership";

interface JournalEntry {batchID:string;parentKey:string;record:BatchRecord;itemKeys:Record<string,string>;}
interface JournalFile {version:1;pending:boolean;entries:JournalEntry[];}
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
export class JournalUnavailableError extends Error {constructor(public readonly state:'unknown-pending'|'invalid',message:string){super(message);this.name='JournalUnavailableError';}}
export class JournalCommitPendingError extends Error {constructor(public readonly cause:unknown){super('The database committed; local batch evidence still needs finalization. Retry saving the journal without importing again.');this.name='JournalCommitPendingError';}}

/** Journal recovery never infers a database commit from a pending file alone. */
export class BatchJournal {
  private queue:Promise<unknown>=Promise.resolve();
  private draft?:JournalFile;
  private scope?:number;
  private dirty=false;
  private committedRecovery?:JournalFile;
  private touched=new Set<Zotero.Item>();
  public track(item:Zotero.Item){this.touched.add(item);}
  public async flush(){await this.queue;}
  public get filename(){return PathUtils.join(Zotero.DataDirectory.dir,"refflow-batch-journal-v1.json");}
  private get io():any{return (Zotero.getMainWindow() as any).IOUtils;}
  private assertScope(libraryID:number){if(this.scope!==undefined&&libraryID!==this.scope)throw new Error('Batch journal transaction cannot access another library');}
  private itemIDs(record:BatchRecord){return new Set([record.parentID,...record.createdIDs,...record.relations.flatMap(row=>[row.id,row.parentID||record.parentID]),...record.attachments.flatMap(row=>[row.id,row.parentID]),...record.memberships.map(row=>row.id),...(record.uses||[]).flatMap(row=>[row.id,...row.parents]),...Object.keys(record.states||{}).map(Number),...(record.noteID?[record.noteID]:[])]);}
  private async load(libraryID?:number):Promise<JournalFile>{
    if(!await this.io.exists(this.filename))return {version:1,pending:false,entries:[]};
    const data=await this.io.readJSON(this.filename);
    if(data?.version!==1||typeof data.pending!=="boolean"||!Array.isArray(data.entries))throw new JournalUnavailableError("invalid","RefFlow batch journal is unreadable; original file preserved");
    if(data.pending)throw new JournalUnavailableError("unknown-pending","RefFlow batch journal contains an interrupted transaction; preserve the file and resolve it before importing or undoing batches");
    const ids=new Set<string>();
    for(const entry of data.entries){
      // Only an unambiguous library identity permits isolating a damaged entry.
      if(!Number.isSafeInteger(entry?.record?.libraryID)||entry.record.libraryID<=0)throw new Error('Malformed RefFlow batch owner');
      if(libraryID!==undefined&&entry.record.libraryID!==libraryID)continue;
      if(!entry||typeof entry.parentKey!=="string"||!entry.parentKey||!/^ref(?:nexus)?_batch_[A-Za-z0-9_]+$/.test(entry.batchID)||!entry.itemKeys||typeof entry.itemKeys!=="object"||Array.isArray(entry.itemKeys))throw new Error("Malformed RefFlow batch journal");
      if(!Number.isSafeInteger(entry.record.parentID)||entry.record.parentID<=0)throw new Error("Malformed RefFlow batch owner");
      validateBatchRecord(entry.record,entry.record.parentID,entry.record.libraryID);
      const key=entry.record.libraryID+":"+entry.batchID;if(ids.has(key))throw new Error("Duplicate RefFlow batch journal");ids.add(key);
      for(const [id,key] of Object.entries(entry.itemKeys))if(!Number.isSafeInteger(Number(id))||Number(id)<=0||typeof key!=="string"||!key)throw new Error("Malformed RefFlow item identity");
    }
    return data;
  }
  private async write(data:JournalFile){await this.io.writeJSON(this.filename,data,{tmpPath:this.filename+".tmp"});}
  private async resumeKnownCommit(){
    if(!this.committedRecovery)return;
    const file=await this.io.readJSON(this.filename);
    if(JSON.stringify(file)!==JSON.stringify({...this.committedRecovery,pending:true}))throw new Error('Pending recovery evidence changed; original file preserved');
    await this.write({...this.committedRecovery,pending:false});this.committedRecovery=undefined;
  }
  public retryCommitted(){const task=this.queue.catch(()=>{}).then(async()=>{if(!this.committedRecovery)throw new Error('No in-process commit evidence; automatic recovery is unavailable');await this.resumeKnownCommit();});this.queue=task;return task;}
  public async diagnostics(){
    await this.queue.catch(()=>{});
    let backupAvailable=false;
    try{backupAvailable=await this.io.exists(this.filename+'.previous');if(!await this.io.exists(this.filename))return {state:'ready',canRetry:false,backupAvailable};const data=await this.io.readJSON(this.filename);
      if(data?.version!==1||typeof data.pending!=='boolean'||!Array.isArray(data.entries))return {state:'invalid',canRetry:false,backupAvailable};
      const canRetry=Boolean(this.committedRecovery&&JSON.stringify(data)===JSON.stringify({...this.committedRecovery,pending:true}));
      return {state:data.pending?(canRetry?'committed-pending':'unknown-pending'):'ready',canRetry,backupAvailable};
    }catch{return {state:'invalid',canRetry:false,backupAvailable};}
  }
  public transaction<T>(job:()=>Promise<T>,libraryID?:number):Promise<T>{
    const task=this.queue.catch(()=>{}).then(async()=>{
      await this.resumeKnownCommit();
      const before=await this.load(libraryID);this.draft=clone(before);this.scope=libraryID;this.dirty=false;this.touched.clear();let prepared=false,committed=false;
      try{
        const result=await (Zotero as any).DB.executeTransaction(async()=>{
          const result=await job();
          if(this.dirty){await this.io.writeJSON(this.filename+'.previous',before,{tmpPath:this.filename+'.previous.tmp'});await this.write({...this.draft!,pending:true});prepared=true;}
          return result;
        });
        committed=true;
        if(prepared){this.committedRecovery=clone(this.draft!);try{await this.write({...this.draft!,pending:false});this.committedRecovery=undefined;}catch(error){throw new JournalCommitPendingError(error);}}
        return result;
      }catch(error){
        if(prepared&&!committed)await this.write(before);
        if(!committed)await Promise.allSettled([...this.touched].map(item=>Promise.resolve().then(()=>(item as any).reload(null,true))));
        throw error;
      }finally{this.draft=undefined;this.scope=undefined;}
    });
    this.queue=task;return task;
  }
  public async get(parent:Zotero.Item,batchID:string):Promise<BatchRecord|undefined>{
    this.assertScope(parent.libraryID);
    const entry=this.draft!.entries.find(row=>row.batchID===batchID&&row.record.libraryID===parent.libraryID);
    if(!entry)return;
    if(entry.record.parentID!==parent.id||entry.parentKey!==parent.key)throw new Error("Batch ownership does not match this parent item");
    for(const id of this.itemIDs(entry.record)){
      const item=await Zotero.Items.getAsync(id);
      if(item&&(item.libraryID!==parent.libraryID||!entry.itemKeys[id]||item.key!==entry.itemKeys[id]))throw new Error("Batch item identity changed or is incomplete; refusing rollback");
    }
    return clone(entry.record);
  }
  public all(libraryID:number){this.assertScope(libraryID);return this.draft!.entries.filter(row=>row.record.libraryID===libraryID).map(row=>({batchID:row.batchID,parentID:row.record.parentID}));}
  public async put(parent:Zotero.Item,batchID:string,record:BatchRecord){
    this.assertScope(parent.libraryID);validateBatchRecord(record,parent.id,parent.libraryID);
    const index=this.draft!.entries.findIndex(row=>row.batchID===batchID&&row.record.libraryID===parent.libraryID);
    if(index>=0)await this.get(parent,batchID);
    const itemKeys:Record<string,string>=index>=0?{...this.draft!.entries[index].itemKeys}:{};
    for(const id of this.itemIDs(record)){
      const item=await Zotero.Items.getAsync(id);if(item){if(item.libraryID!==parent.libraryID)throw new Error('Batch identity belongs to another library');if(itemKeys[id]&&itemKeys[id]!==item.key)throw new Error('Batch item identity changed; refusing update');itemKeys[id]=item.key;this.track(item);}
    }
    this.track(parent);const entry={batchID,parentKey:parent.key,record:clone(record),itemKeys};
    if(index>=0&&JSON.stringify(this.draft!.entries[index])===JSON.stringify(entry))return;
    if(index>=0)this.draft!.entries[index]=entry;else this.draft!.entries.push(entry);this.dirty=true;
  }
  public remove(parent:Zotero.Item,batchID:string){this.assertScope(parent.libraryID);const previous=this.draft!.entries.length;this.draft!.entries=this.draft!.entries.filter(row=>!(row.batchID===batchID&&row.record.libraryID===parent.libraryID&&row.record.parentID===parent.id));if(previous!==this.draft!.entries.length)this.dirty=true;}
}
export default new BatchJournal();
