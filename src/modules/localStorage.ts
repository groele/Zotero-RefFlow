import {encodeData,utf8Bytes} from "./jsonData";
export interface StorageOptions {maxItems?:number;maxBytes?:number;entryMaxBytes?:number;}
/** Owned, bounded cache. Zotero.File owns atomic replacement of its cache file. */
class LocalStorage {
  public filename!:string;
  private data:Record<string,any>=Object.create(null);
  public lock:any;
  public isInitialized=false;
  private saveTimer:any=null;
  private writeQueue:Promise<void>=Promise.resolve();
  private disposed=false;
  private dirty=false;
  private diskReady=false;
  private sizes=new Map<string,number>();
  private bytes=3;
  private options:Required<StorageOptions>;
  private listeners = new Set<() => void>();
  public metrics={evictions:0,expired:0,skipped:0,writes:0,writeFailures:0};
  get cache(){return JSON.parse(encodeData(this.data)!);}
  get cacheUsage(){return {items:this.sizes.size,bytes:this.sizes.size?this.bytes:3,maxBytes:this.options.maxBytes,maxItems:this.options.maxItems,persistent:this.diskReady,writeFailed:this.metrics.writeFailures>0&&this.dirty};}
  constructor(filename:string,options:StorageOptions={},private expired?: (key:string,value:any)=>boolean){
    this.options={maxItems:250,maxBytes:8*1024*1024,entryMaxBytes:2*1024*1024,...options};
    this.lock=(Zotero.Promise as any).defer();void this.init(filename);
  }
  subscribe(listener:()=>void){this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};}
  private notify(){for(const listener of this.listeners){try{listener();}catch(error){ztoolkit.log("Cache usage listener failed",String(error));}}}
  private prune(){
    for(const [itemKey,fields] of Object.entries(this.data)){
      for(const [key,value] of Object.entries(fields)){
        if(this.expired?.(key,value)){this.dropKey(itemKey,key);this.metrics.expired++;this.dirty=true;}
      }
    }
  }
  async maintain(options:StorageOptions={}){
    await this.lock.promise;if(this.disposed)return;
    this.options={...this.options,...options};this.prune();this.trim();
    if(this.dirty)this.scheduleSave();else this.notify();
  }
  private cacheKey(item:Zotero.Item|{key:string;libraryID?:number}|undefined){
    const libraryID=Number(item?.libraryID);
    if(!item?.key||!Number.isSafeInteger(libraryID)||libraryID<1)return;
    return `${libraryID}:${item.key}`;
  }
  private size(key:string,encoded:string){
    const indented=JSON.stringify(JSON.parse(encoded),null,2).replace(/\n/g,"\n  ");
    return utf8Bytes(`  ${JSON.stringify(key)}: ${indented}`)+2;
  }
  private evict(key:string){this.bytes-=this.sizes.get(key)||0;this.sizes.delete(key);delete this.data[key];this.dirty=true;}
  private touch(key:string){if(Object.hasOwn(this.data,key)){const value=this.data[key];delete this.data[key];this.data[key]=value;}}
  private assign(key:string,encoded:string){
    this.bytes-=this.sizes.get(key)||0;
    delete this.data[key];this.data[key]=JSON.parse(encoded);
    const size=this.size(key,encoded);this.sizes.set(key,size);this.bytes+=size;
  }
  private trim(){
    while(this.sizes.size>this.options.maxItems||this.bytes>this.options.maxBytes){
      const key=Object.keys(this.data)[0];if(!key)break;this.evict(key);this.metrics.evictions++;
    }
  }
  private dropKey(itemKey:string,key:string){
    if(!Object.hasOwn(this.data[itemKey]||{},key))return false;
    delete this.data[itemKey][key];
    if(!Object.keys(this.data[itemKey]).length)this.evict(itemKey);
    else this.assign(itemKey,encodeData(this.data[itemKey])!);
    return true;
  }
  async init(filename:string){
    try {
      const basePath=Zotero.DataDirectory.dir;if(!basePath)throw new Error("Zotero data directory unavailable");
      this.filename=PathUtils.join(basePath,`${filename}-reference-cache.json`);
      const legacy=PathUtils.join(basePath,`${filename}-v2.json`);
      const pathToFile=Zotero.File.pathToFile;
      if (pathToFile && !pathToFile(this.filename).exists() && pathToFile(legacy).exists()) {
        const io = (globalThis as any).IOUtils ?? (Zotero.getMainWindow() as any).IOUtils;
        try {
          await io.move(legacy, this.filename, {noOverwrite:true});
        } catch (error) {
          // Another initializer may have completed the same atomic rename.
          if (!pathToFile(this.filename).exists()) throw error;
        }
      }
      this.diskReady=true;
      try {
        const file=(Zotero.File as any).pathToFile?.(this.filename);
        const loadLimit=Math.max(this.options.maxBytes,64*1024*1024);
        if(file?.exists() && file.fileSize>loadLimit)throw new Error("Oversized reference cache");
        const raw=file?.exists()===false?"{}":await Zotero.File.getContentsAsync(this.filename);
        if(typeof raw!=="string" || utf8Bytes(raw)>loadLimit)throw new Error("Invalid reference cache size");
        const parsed=JSON.parse(raw);
        if(parsed&&typeof parsed==="object"&&!Array.isArray(parsed))for(const [key,value] of Object.entries(parsed)){
          if(!/^[1-9]\d*:[^:]+$/.test(key)||!value||typeof value!=="object"||Array.isArray(value))continue;
          const encoded=encodeData(value);
          if(encoded!==undefined&&this.size(key,encoded)<=this.options.entryMaxBytes)this.assign(key,encoded);
          else this.dirty=true;
        }
      } catch(error){this.data=Object.create(null);this.sizes.clear();this.bytes=3;ztoolkit.log("Reference cache rebuild",String(error));}
      this.prune();this.trim();
    } catch(error){ztoolkit.log("LocalStorage memory fallback",String(error));}
    finally{this.isInitialized=true;this.lock.resolve();if(this.dirty)this.scheduleSave();this.notify();}
  }
  get(item:Zotero.Item|{key:string;libraryID?:number}|undefined,key:string):any {
    const itemKey=this.cacheKey(item);if(!itemKey||!this.isInitialized)return;
    this.touch(itemKey);
    const value=Object.hasOwn(this.data[itemKey]||{},key)?this.data[itemKey][key]:undefined;
    const encoded=encodeData(value);return encoded===undefined?undefined:JSON.parse(encoded);
  }
  async getAsync(item:Zotero.Item|{key:string;libraryID?:number}|undefined,key:string){await this.lock.promise;return this.get(item,key);}
  private scheduleSave(delayMs=250){
    this.dirty=true;this.notify();if(this.disposed)return;
    if(this.saveTimer)globalThis.clearTimeout(this.saveTimer);
    this.saveTimer=globalThis.setTimeout(()=>{this.saveTimer=null;void this.flush().catch(error=>ztoolkit.log("Reference cache save failed",String(error)));},delayMs);
  }
  async flush(){
    if(this.saveTimer){globalThis.clearTimeout(this.saveTimer);this.saveTimer=null;}
    await this.lock.promise;
    if(!this.diskReady||!this.dirty){await this.writeQueue;return;}
    const encoded=encodeData(this.data);if(encoded===undefined)throw new Error("Invalid reference cache snapshot");
    const snapshot=JSON.stringify(JSON.parse(encoded),null,2)+"\n";
    this.dirty=false;
    const write=this.writeQueue.catch(()=>{}).then(async()=>{await Zotero.File.putContentsAsync(this.filename,snapshot);this.metrics.writes++;});
    this.writeQueue=write;
    try{await write;}catch(error){this.dirty=true;this.metrics.writeFailures++;throw error;}finally{this.notify();}
  }
  async dispose(){this.disposed=true;try{await this.flush();}finally{this.listeners.clear();}}
  async set(item:Zotero.Item|{key:string;libraryID?:number}|undefined,key:string,value:any){
    const itemKey=this.cacheKey(item);if(!itemKey||["__proto__","prototype","constructor"].includes(key))return;
    await this.lock.promise;if(this.disposed)return;
    const candidate={...(this.data[itemKey]||{}),[key]:value},encoded=encodeData(candidate);
    if(encoded===undefined||this.size(itemKey,encoded)>Math.min(this.options.entryMaxBytes,this.options.maxBytes-3)){
      this.metrics.skipped++;if(this.dropKey(itemKey,key))this.scheduleSave();else this.notify();return;
    }
    this.assign(itemKey,encoded);this.prune();this.trim();this.scheduleSave();
  }
  async delete(item:Zotero.Item|{key:string;libraryID?:number}|undefined,key:string){
    const itemKey=this.cacheKey(item);if(!itemKey)return;await this.lock.promise;if(this.disposed)return;
    if(this.dropKey(itemKey,key))this.scheduleSave();
  }
  async clear(item:Zotero.Item|{key:string;libraryID?:number}|undefined){
    const itemKey=this.cacheKey(item);if(!itemKey)return;await this.lock.promise;if(this.disposed)return;
    if(Object.hasOwn(this.data,itemKey)){this.evict(itemKey);this.scheduleSave();}
  }
}
export default LocalStorage;
