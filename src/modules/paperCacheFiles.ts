import {utf8Bytes} from "./jsonData";

export interface PaperIndexEntry {
  bytes: number;
  modified: number;
  accessed: number;
  fields: Record<string, any>;
}
export type PaperIndex = Record<string, PaperIndexEntry>;
export const validPaperKey = (key: string) => /^[1-9]\d*:[A-Za-z0-9_-]+$/.test(key);
export const readableJSON = (value: unknown) => JSON.stringify(value, null, 2) + "\n";

export function indexEntry(data: Record<string, any>, bytes: number, accessed = Date.now(), modified = 0): PaperIndexEntry {
  const fields: Record<string, any> = Object.create(null);
  for (const [key, value] of Object.entries(data)) {
    fields[key] = key.startsWith("References-") ? {
      schema: value?.schema, savedAt: value?.savedAt,
      snapshot: value?.snapshot && {
        source: value.snapshot.source, partial: value.snapshot.partial,
        truncated: value.snapshot.truncated, status: value.snapshot.status
      }
    } : null;
  }
  return {bytes, modified, accessed, fields};
}

/** Cache-owned paths only. File replacement is delegated to Zotero's atomic writer. */
export default class PaperCacheFiles {
  readonly directory: string;
  readonly filename: string;
  readonly io: any;
  public indexBytes = 0;
  constructor(base: string, name: string, private entryLimit: number) {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error("Invalid cache directory name");
    this.directory = PathUtils.join(base, `${name}-reference-cache`);
    this.filename = PathUtils.join(this.directory, "index.json");
    this.io = (globalThis as any).IOUtils ?? (Zotero.getMainWindow() as any).IOUtils;
    if (!this.io) throw new Error("Cache filesystem unavailable");
  }
  paperPath(key: string) {
    if (!validPaperKey(key)) throw new Error("Invalid paper cache key");
    const [library, item] = key.split(":");
    return PathUtils.join(this.directory, library, `${item}.json`);
  }
  async read(key: string): Promise<Record<string, any>> {
    const path = this.paperPath(key);
    const stat = await this.io.stat(path);
    if (stat.size > this.entryLimit) throw new Error("Oversized paper cache");
    const raw = await Zotero.File.getContentsAsync(path);
    if (typeof raw !== "string" || utf8Bytes(raw) > this.entryLimit) throw new Error("Invalid paper cache size");
    const parsed = JSON.parse(raw);
    if (parsed.schema !== 1 || parsed.itemKey !== key || !parsed.data ||
      typeof parsed.data !== "object" || Array.isArray(parsed.data)) throw new Error("Invalid paper cache identity");
    return parsed.data;
  }
  encode(key: string, data: Record<string, any>) { return readableJSON({schema: 1, itemKey: key, data}); }
  async write(key: string, text: string) {
    const path = this.paperPath(key);
    await this.io.makeDirectory(PathUtils.join(this.directory, key.split(":")[0]), {ignoreExisting: true});
    await Zotero.File.putContentsAsync(path, text);
    return (await this.io.stat(path)).lastModified;
  }
  async remove(key: string) { await this.io.remove(this.paperPath(key), {ignoreAbsent: true}); }
  async writeIndex(entries: PaperIndex) {
    const text = readableJSON({schema: 1, entries});
    await Zotero.File.putContentsAsync(this.filename, text);
    this.indexBytes = utf8Bytes(text);
  }
  async load(): Promise<PaperIndex> {
    await this.io.makeDirectory(this.directory, {ignoreExisting: true});
    let saved: PaperIndex = Object.create(null);
    try {
      const stat = await this.io.stat(this.filename);
      if (stat.size > 16 * 1048576) throw new Error("Oversized cache index");
      this.indexBytes = stat.size;
      const index = JSON.parse(String(await Zotero.File.getContentsAsync(this.filename)));
      if (index.schema !== 1 || !index.entries || typeof index.entries !== "object" || Array.isArray(index.entries)) throw new Error("Invalid cache index");
      saved = index.entries;
    } catch { /* Missing or interrupted indexes are rebuilt from individual files. */ }
    const entries: PaperIndex = Object.create(null);
    for (const folder of await this.io.getChildren(this.directory)) {
      const library = folder.split(/[\\/]/).pop()!;
      if (!/^[1-9]\d*$/.test(library) || (await this.io.stat(folder)).type !== "directory") continue;
      for (const path of await this.io.getChildren(folder)) {
        const name = path.split(/[\\/]/).pop()!;
        if (!/^[A-Za-z0-9_-]+\.json$/.test(name)) continue;
        const key = `${library}:${name.slice(0, -5)}`;
        try {
          const stat = await this.io.stat(path);
          if (stat.type !== "regular" || stat.size > this.entryLimit) throw new Error("Invalid paper cache file");
          const old = saved[key];
          if (old && old.bytes === stat.size && old.modified === stat.lastModified &&
            Number.isFinite(old.accessed) && old.fields && typeof old.fields === "object" && !Array.isArray(old.fields)) {
            entries[key] = old;
          } else {
            const data = await this.read(key);
            entries[key] = indexEntry(data, stat.size, stat.lastModified, stat.lastModified);
          }
        } catch (error) {
          ztoolkit.log("Invalid paper cache skipped", key, String(error));
          await this.remove(key);
        }
      }
    }
    return entries;
  }
}
