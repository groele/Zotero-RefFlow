/**
 * Unit Test Environment Setup & XPCOM Mocks
 */

// Mock Zotero global environment
(globalThis as any).PathUtils = {join: (...parts: string[]) => parts.join("/"),parent:(path:string)=>path.slice(0,path.lastIndexOf("/"))};
const mockCacheFiles = new Map<string,{text:string;modified:number}>();
const mockCacheDirectories = new Set<string>();
let mockCacheClock = 0;
const mockCacheIO = {
  exists:async(path:string)=>mockCacheFiles.has(path)||mockCacheDirectories.has(path),
  makeDirectory:async(path:string)=>{mockCacheDirectories.add(path);},
  stat:async(path:string)=>{
    if(mockCacheDirectories.has(path))return {type:"directory",size:0,lastModified:0};
    const file=mockCacheFiles.get(path);if(!file)throw Error("Missing fixture file");
    return {type:"regular",size:Buffer.byteLength(file.text),lastModified:file.modified};
  },
  getChildren:async(path:string)=>[...mockCacheDirectories,...mockCacheFiles.keys()].filter(key=>key.startsWith(path+"/")&&!key.slice(path.length+1).includes("/")),
  remove:async(path:string)=>{mockCacheFiles.delete(path);},
  move:async(from:string,to:string,options:any)=>{
    if(options?.noOverwrite&&mockCacheFiles.has(to))throw Error("Destination exists");
    const file=mockCacheFiles.get(from);if(!file)throw Error("Missing fixture file");
    mockCacheFiles.set(to,file);mockCacheFiles.delete(from);
  }
};
(globalThis as any).Zotero = (globalThis as any).Zotero || {
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  Promise: {
    defer: () => {
      let resolve: any, reject: any;
      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    },
    delay: (ms: number) => new Promise(r => setTimeout(r, ms))
  },
  File: {
    getContentsAsync: async (path: string) => mockCacheFiles.get(path)?.text ?? "{}",
    putContentsAsync: async (path: string, content: string) => {mockCacheFiles.set(path,{text:String(content),modified:++mockCacheClock});}
  },
  DataDirectory: {
    dir: "/mock/zotero/data"
  },
  getMainWindow: () => ({IOUtils: mockCacheIO}),
  getTempDirectory: () => ({ path: "/mock/temp/zotero", leafName: "zotero" }),
  getProfileDirectory: () => ({ path: "/mock/zotero/profile" }),
  Prefs: {
    get: (key: string) => undefined,
    set: (key: string, val: any) => {}
  },
  Search: class {
    public libraryID: number = 1;
    public conditions: any[] = [];
    addCondition(field: string, op: string, val: string) {
      this.conditions.push({ field, op, val });
    }
    async search() {
      return [101, 102, 999]; // 999 will represent parentItem
    }
  },
  Items: {
    getAsync: async (ids: number[]) => {
      return ids.map(id => ({
        id,
        libraryID: 1,
        getField: (f: string) => (f === "extra" ? `import_batch: ref_batch_mock` : ""),
        eraseTx: async () => true
      }));
    },
    trashTx: async (ids: number[]) => true
  },
  ItemTypes: {
    getName: (id: number) => {
      const map: Record<number, string> = { 1: "journalArticle", 2: "book", 3: "conferencePaper" };
      return map[id] || "journalArticle";
    },
    getTypes: () => [
      { id: 1, name: "journalArticle" },
      { id: 2, name: "book" },
      { id: 3, name: "conferencePaper" }
    ]
  },
  HTTP: {
    request: async (method: string, url: string, options: any) => ({
      status: 200,
      response: { message: "ok" },
      responseText: '{"message":"ok"}'
    })
  }
};

(globalThis as any).ztoolkit = (globalThis as any).ztoolkit || {
  log: (...args: any[]) => {},
  getDOMParser: () => ({
    parseFromString: (str: string, type: string) => ({
      childNodes: [{}, { querySelector: () => null, querySelectorAll: () => [] }],
      head: { querySelector: () => null }
    })
  })
};

(globalThis as any).window = (globalThis as any).window || {
  AbortController: globalThis.AbortController,
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  setInterval: globalThis.setInterval,
  clearInterval: globalThis.clearInterval
};

(globalThis as any).document = (globalThis as any).document || {
  createElement: (tag: string) => {
    let _inner = "";
    return {
      get innerHTML() { return _inner; },
      set innerHTML(val: string) { _inner = val; },
      get textContent() { return _inner.replace(/<[^>]+>/g, ""); },
      get innerText() { return _inner.replace(/<[^>]+>/g, ""); },
      setAttribute: () => {},
      getAttribute: () => null
    };
  }
};
