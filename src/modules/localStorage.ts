import { config } from "../../package.json";

class LocalStorage {
  public filename!: string;
  public cache: Record<string, any> = {};
  public lock: any;
  public isInitialized: boolean = false;
  private saveTimer: any = null;
  private writeQueue: Promise<void> = Promise.resolve();
  private disposed = false;
  private dirty = false;

  private trim(){while(Object.keys(this.cache).length>250){delete this.cache[Object.keys(this.cache)[0]];this.dirty=true;}}
  private touch(key:string){if(this.cache[key]){const value=this.cache[key];delete this.cache[key];this.cache[key]=value;}}
  private cacheKey(item: Zotero.Item | { key: string; libraryID?: number } | undefined): string | undefined {
    if (!item || !("key" in item) || !item.key) return undefined;
    const libraryID = Number((item as any).libraryID) || 1;
    return `${libraryID}:${item.key}`;
  }

  constructor(filename: string) {
    this.lock = (Zotero.Promise as any).defer();
    this.init(filename);
    (Zotero as any).addShutdownListener?.(() => this.dispose());
  }

  async init(filename: string) {
    try {
      // Zotero 10 exposes PathUtils. Persist only in its data directory;
      // if unavailable, keep an in-memory cache instead of guessing a path.
      const basePath = Zotero.DataDirectory.dir;
      if (!basePath) throw new Error("Zotero data directory unavailable");
      this.filename = (globalThis as any).PathUtils.join(basePath, `${filename}-v2.json`);

      try {
        const exists=(Zotero.File as any).pathToFile?.(this.filename)?.exists();
        const rawString = exists===false ? "{}" : (await Zotero.File.getContentsAsync(this.filename)) as string;
        const parsed = JSON.parse(rawString);
        this.cache = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
      } catch {
        this.cache = {};
      }
      this.trim();
      this.isInitialized = true;
    } catch (e) {
      ztoolkit.log("LocalStorage init fallback:", e);
      this.cache = {};
      this.isInitialized = true;
    } finally {
      this.lock.resolve();
    }
  }

  get(item: Zotero.Item | { key: string; libraryID?: number } | undefined, key: string): any {
    const itemKey = this.cacheKey(item);
    if (!itemKey) return undefined;
    if (!this.isInitialized) return undefined;
    this.touch(itemKey);
    return this.cache?.[itemKey]?.[key];
  }

  async getAsync(item: Zotero.Item | { key: string; libraryID?: number } | undefined, key: string): Promise<any> {
    const itemKey = this.cacheKey(item);
    if (!itemKey) return undefined;
    await this.lock.promise;
    this.touch(itemKey);
    return this.cache?.[itemKey]?.[key];
  }

  /**
   * 防抖持久化至磁盘，防止高频批处理时频繁触发磁盘 I/O 锁竞争
   */
  private scheduleSave(delayMs: number = 250) {
    this.dirty = true;
    if(this.disposed) return;
    if (this.saveTimer) {
      window.clearTimeout(this.saveTimer);
    }
    this.saveTimer = window.setTimeout(async () => {
      this.saveTimer = null;
      await this.flush().catch(err => ztoolkit.log("Reference cache save failed",err));
    }, delayMs);
  }

  public async flush(): Promise<void> {
    if(this.saveTimer){window.clearTimeout(this.saveTimer);this.saveTimer=null;}
    await this.lock.promise;
    if (!this.filename || !this.cache || !this.dirty) {await this.writeQueue;return;}
    const snapshot = JSON.stringify(this.cache,(key,value)=>key==="_item"?undefined:value);
    this.dirty=false;
    const write=this.writeQueue.catch(()=>{}).then(async () => {
      await Zotero.File.putContentsAsync(this.filename, snapshot);
    });
    this.writeQueue=write;
    try {await write;} catch(err){this.dirty=true;throw err;}
  }

  public async dispose(): Promise<void> {this.disposed=true;await this.flush();}

  async set(item: Zotero.Item | { key: string; libraryID?: number } | undefined, key: string, value: any): Promise<void> {
    const itemKey = this.cacheKey(item);
    if (!itemKey) return;
    await this.lock.promise;
    if(this.disposed) return;
    (this.cache[itemKey] ??= {})[key] = value;
    this.touch(itemKey);this.trim();
    this.scheduleSave(250);
  }

  async delete(item: Zotero.Item | { key: string; libraryID?: number } | undefined, key: string): Promise<void> {
    const itemKey = this.cacheKey(item);
    if (!itemKey) return;
    await this.lock.promise;
    if(this.disposed) return;
    if (this.cache[itemKey]) {
      delete this.cache[itemKey][key];
      if (Object.keys(this.cache[itemKey]).length === 0) delete this.cache[itemKey];
      this.scheduleSave(250);
    }
  }

  async clear(item: Zotero.Item | { key: string; libraryID?: number } | undefined): Promise<void> {
    const itemKey = this.cacheKey(item);
    if (!itemKey) return;
    await this.lock.promise;
    if(this.disposed) return;
    delete this.cache[itemKey];
    this.scheduleSave(250);
  }
}

export default LocalStorage;
