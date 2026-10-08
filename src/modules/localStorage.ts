import { config } from "../../package.json";

class LocalStorage {
  public filename!: string;
  public cache: Record<string, any> = {};
  public lock: any;
  public isInitialized: boolean = false;
  private saveTimer: any = null;
  private writeQueue: Promise<void> = Promise.resolve();

  private cacheKey(item: Zotero.Item | { key: string; libraryID?: number } | undefined): string | undefined {
    if (!item || !("key" in item) || !item.key) return undefined;
    const libraryID = Number((item as any).libraryID) || 1;
    return `${libraryID}:${item.key}`;
  }

  constructor(filename: string) {
    this.lock = (Zotero.Promise as any).defer();
    this.init(filename);
  }

  async init(filename: string) {
    try {
      // 优先使用 Zotero 永久数据目录或 Profile 目录，彻底避免 OS Temp 清理导致缓存丢失
      let basePath = "";
      if (Zotero.DataDirectory?.dir) {
        basePath = Zotero.DataDirectory.dir;
      } else if (typeof Zotero.getProfileDirectory === "function" && Zotero.getProfileDirectory()?.path) {
        basePath = Zotero.getProfileDirectory().path;
      } else {
        try {
          const temp = Zotero.getTempDirectory();
          basePath = temp.path.replace(temp.leafName, "");
        } catch {
          basePath = "";
        }
      }

      const win: any = Zotero.getMainWindow();
      if (typeof (globalThis as any).PathUtils !== "undefined" && (globalThis as any).PathUtils.join) {
        this.filename = (globalThis as any).PathUtils.join(basePath, `${filename}-v2.json`);
      } else if (win?.OS?.Path?.join) {
        this.filename = win.OS.Path.join(basePath, `${filename}-v2.json`);
      } else {
        this.filename = `${basePath}/${filename}-v2.json`;
      }

      try {
        const rawString = (await Zotero.File.getContentsAsync(this.filename)) as string;
        const parsed = JSON.parse(rawString);
        this.cache = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
      } catch {
        this.cache = {};
      }
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
    if (!this.isInitialized && this.filename) {
      // 冷启动同步降级保底：避免异步未就绪前同步读取导致伪空缓存
      try {
        if (typeof (Zotero as any).File?.getContents === "function") {
          const raw = (Zotero as any).File.getContents(this.filename);
          if (raw) {
            this.cache = JSON.parse(raw);
            this.isInitialized = true;
          }
        }
      } catch {
        // 容错降级
      }
    }
    return this.cache?.[itemKey]?.[key];
  }

  async getAsync(item: Zotero.Item | { key: string; libraryID?: number } | undefined, key: string): Promise<any> {
    const itemKey = this.cacheKey(item);
    if (!itemKey) return undefined;
    await this.lock.promise;
    return this.cache?.[itemKey]?.[key];
  }

  /**
   * 防抖持久化至磁盘，防止高频批处理时频繁触发磁盘 I/O 锁竞争
   */
  private scheduleSave(delayMs: number = 250) {
    if (this.saveTimer) {
      window.clearTimeout(this.saveTimer);
    }
    this.saveTimer = window.setTimeout(async () => {
      this.saveTimer = null;
      await this.flush();
    }, delayMs);
  }

  public async flush(): Promise<void> {
    if (!this.filename || !this.cache) return;
    const snapshot = JSON.stringify(this.cache);
    this.writeQueue = this.writeQueue.then(async () => {
      await Zotero.File.putContentsAsync(this.filename, snapshot);
    }).catch(err => {
      ztoolkit.log("LocalStorage save failed:", err);
    });
    await this.writeQueue;
  }

  async set(item: Zotero.Item | { key: string; libraryID?: number } | undefined, key: string, value: any): Promise<void> {
    const itemKey = this.cacheKey(item);
    if (!itemKey) return;
    await this.lock.promise;
    (this.cache[itemKey] ??= {})[key] = value;
    this.scheduleSave(250);
  }

  async delete(item: Zotero.Item | { key: string; libraryID?: number } | undefined, key: string): Promise<void> {
    const itemKey = this.cacheKey(item);
    if (!itemKey) return;
    await this.lock.promise;
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
    delete this.cache[itemKey];
    this.scheduleSave(250);
  }
}

export default LocalStorage;
