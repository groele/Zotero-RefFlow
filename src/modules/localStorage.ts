import {encodeData, utf8Bytes} from "./jsonData";
import PaperCacheFiles, {indexEntry, validPaperKey} from "./paperCacheFiles";
import type {PaperIndex} from "./paperCacheFiles";

export interface StorageOptions {maxItems?: number; maxBytes?: number; entryMaxBytes?: number;}
type CacheItem = Zotero.Item | {key: string; libraryID?: number} | undefined;

/** A bounded paper index with lazy payload reads and serialized incremental writes. */
export default class LocalStorage {
  public filename!: string;
  public directory!: string;
  public lock: any;
  public isInitialized = false;
  public metrics = {evictions: 0, expired: 0, skipped: 0, writes: 0, writeFailures: 0};
  private files?: PaperCacheFiles;
  private entries: PaperIndex = Object.create(null);
  private data: Record<string, Record<string, any>> = Object.create(null);
  private changed = new Set<string>();
  private removed = new Set<string>();
  private dirty = false;
  private writeFailed = false;
  private disposed = false;
  private timer?: ReturnType<typeof globalThis.setTimeout>;
  private queue: Promise<unknown> = Promise.resolve();
  private options: Required<StorageOptions>;
  private listeners = new Set<() => void>();

  constructor(name: string, options: StorageOptions = {}, private expired?: (key: string, value: any) => boolean) {
    this.options = {maxItems: 250, maxBytes: 8 * 1048576, entryMaxBytes: 2 * 1048576, ...options};
    this.lock = (Zotero.Promise as any).defer();
    void this.init(name);
  }
  get cache() { return JSON.parse(encodeData(this.data)!); }
  get cacheUsage() {
    return {items: Object.keys(this.entries).length, bytes: Object.values(this.entries).reduce((sum, entry) => sum + entry.bytes, 0),
      maxBytes: this.options.maxBytes, maxItems: this.options.maxItems, indexBytes: this.files?.indexBytes || 0,
      persistent: !!this.files, writeFailed: this.writeFailed};
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  private notify() {
    for (const listener of this.listeners) {
      try { listener(); } catch (error) { ztoolkit.log("Cache usage listener failed", String(error)); }
    }
  }
  private key(item: CacheItem) {
    const library = Number(item?.libraryID), key = `${library}:${item?.key}`;
    return Number.isSafeInteger(library) && library > 0 && item?.key && validPaperKey(key) ? key : undefined;
  }
  private async serialized<T>(operation: () => Promise<T>): Promise<T> {
    await this.lock.promise;
    const result = this.queue.catch(() => {}).then(operation);
    this.queue = result;
    return result;
  }
  private schedule() {
    this.dirty = true;
    this.notify();
    if (this.disposed) return;
    if (this.timer) globalThis.clearTimeout(this.timer);
    this.timer = globalThis.setTimeout(() => {
      this.timer = undefined;
      void this.flush().catch(error => ztoolkit.log("Paper cache save failed", String(error)));
    }, 250);
  }
  private async init(name: string) {
    try {
      const base = Zotero.DataDirectory.dir;
      if (!base) throw new Error("Zotero data directory unavailable");
      const files = new PaperCacheFiles(base, name, this.options.entryMaxBytes);
      const entries = await files.load();
      this.files = files;
      this.filename = files.filename;
      this.directory = files.directory;
      this.entries = entries;
      await this.prune();
      this.trim();
      this.dirty = true;
    } catch (error) { ztoolkit.log("Paper cache memory fallback", String(error)); }
    finally {
      this.isInitialized = true;
      this.lock.resolve();
      if (this.dirty) this.schedule();
      this.notify();
    }
  }
  private async load(key: string) {
    if (this.data[key] || !this.entries[key]) return;
    try {
      this.data[key] = await this.files!.read(key);
      const entry = this.entries[key];
      const stat = await this.files!.io.stat(this.files!.paperPath(key));
      this.entries[key] = indexEntry(this.data[key], stat.size, entry.accessed, stat.lastModified);
    }
    catch (error) {
      ztoolkit.log("Paper cache payload unavailable", key, String(error));
      this.evict(key);
      this.schedule();
    }
  }
  private encode(key: string, data: Record<string, any>) {
    const owned = encodeData(data);
    if (owned === undefined) return;
    return JSON.stringify({schema: 1, itemKey: key, data: JSON.parse(owned)}, null, 2) + "\n";
  }
  private assign(key: string, data: Record<string, any>, accessed = Date.now()) {
    const encoded = this.encode(key, data)!;
    this.data[key] = JSON.parse(encodeData(data)!);
    this.entries[key] = indexEntry(this.data[key], utf8Bytes(encoded), accessed);
    this.changed.add(key);
    this.removed.delete(key);
  }
  private evict(key: string) {
    delete this.entries[key]; delete this.data[key];
    this.changed.delete(key); this.removed.add(key); this.dirty = true;
  }
  private trim() {
    let {items, bytes} = this.cacheUsage;
    if (items <= this.options.maxItems && bytes <= this.options.maxBytes) return;
    const oldest = Object.keys(this.entries).sort((a, b) => this.entries[a].accessed - this.entries[b].accessed);
    for (const key of oldest) {
      if (items <= this.options.maxItems && bytes <= this.options.maxBytes) break;
      bytes -= this.entries[key].bytes; items--;
      this.evict(key); this.metrics.evictions++;
    }
  }
  private async prune() {
    if (!this.expired) return;
    for (const [item, entry] of Object.entries(this.entries)) {
      const fields = this.data[item] || entry.fields;
      const keys = Object.keys(fields).filter(key => this.expired!(key, fields[key]));
      if (!keys.length) continue;
      await this.load(item);
      if (!this.data[item]) continue;
      const accessed = entry.accessed;
      for (const key of keys) { delete this.data[item][key]; this.metrics.expired++; }
      if (Object.keys(this.data[item]).length) this.assign(item, this.data[item], accessed);
      else this.evict(item);
      this.dirty = true;
    }
  }
  async maintain(options: StorageOptions = {}) {
    return this.serialized(async () => {
      if (this.disposed) return;
      this.options = {...this.options, ...options};
      await this.prune(); this.trim();
      if (this.dirty) this.schedule(); else this.notify();
    });
  }
  get(item: CacheItem, field: string): any {
    const key = this.key(item);
    if (!key || !this.isInitialized || !this.data[key]) return;
    this.entries[key].accessed = Date.now();
    if (!this.disposed) this.schedule();
    const value = Object.hasOwn(this.data[key], field) ? this.data[key][field] : undefined;
    const encoded = encodeData(value);
    return encoded === undefined ? undefined : JSON.parse(encoded);
  }
  async getAsync(item: CacheItem, field: string) {
    return this.serialized(async () => {
      const key = this.key(item);
      if (!key || this.disposed) return;
      await this.load(key);
      const result = this.get(item, field);
      this.trim();
      return result;
    });
  }
  async set(item: CacheItem, field: string, value: any) {
    return this.serialized(async () => {
      const key = this.key(item);
      if (!key || this.disposed || ["__proto__", "constructor", "prototype"].includes(field)) return;
      await this.load(key);
      const candidate = {...(this.data[key] || {}), [field]: value};
      const encoded = this.encode(key, candidate);
      if (!encoded || utf8Bytes(encoded) > Math.min(this.options.entryMaxBytes, this.options.maxBytes)) {
        this.metrics.skipped++;
        await this.drop(key, field);
        this.notify();
        return;
      }
      this.assign(key, candidate);
      await this.prune(); this.trim(); this.schedule();
    });
  }
  private async drop(key: string, field: string) {
    await this.load(key);
    if (!Object.hasOwn(this.data[key] || {}, field)) return;
    delete this.data[key][field];
    if (Object.keys(this.data[key]).length) this.assign(key, this.data[key], this.entries[key].accessed);
    else this.evict(key);
    this.schedule();
  }
  async delete(item: CacheItem, field: string) {
    return this.serialized(async () => {
      const key = this.key(item);
      if (key && !this.disposed) await this.drop(key, field);
    });
  }
  async clear(item: CacheItem) {
    return this.serialized(async () => {
      const key = this.key(item);
      if (key && !this.disposed && this.entries[key]) { this.evict(key); this.schedule(); }
    });
  }
  async flush() {
    if (this.timer) { globalThis.clearTimeout(this.timer); this.timer = undefined; }
    return this.serialized(async () => {
      if (!this.files || !this.dirty) return;
      try {
        for (const key of this.changed) {
          this.entries[key].modified = await this.files.write(key, this.encode(key, this.data[key])!);
          this.metrics.writes++;
        }
        for (const key of this.removed) await this.files.remove(key);
        await this.files.writeIndex(this.entries);
        this.changed.clear(); this.removed.clear();
        this.dirty = this.writeFailed = false;
      } catch (error) { this.writeFailed = true; this.metrics.writeFailures++; throw error; }
      finally { this.notify(); }
    });
  }
  async dispose() {
    this.disposed = true;
    try { await this.flush(); } finally { this.listeners.clear(); }
  }
}
