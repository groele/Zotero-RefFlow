/**
 * 健壮的学术网络请求器 (Robust Academic HTTP Client)
 * 具备请求超时控制、429/503 指数退避自动重试、500项 LRU 内存容量限制与 RFC 5854 内容协商支持
 */

import { version, homepage } from "../../package.json";

export interface RequestOptions { timeoutMs?: number; budgetMs?: number; retryDelayMs?: number; cacheTTL?: number; maxConcurrent?: number; maxQueued?: number; }

export default class Requests {
  private cache: Map<string, any> = new Map();
  private cacheTimes = new Map<string, number>();
  private inFlight: Map<string, Promise<any>> = new Map();
  private readonly MAX_CACHE_ENTRIES: number = 500;
  private options: Required<RequestOptions>;
  private active=0;
  private queue: Array<() => void> = [];
  private cancellers = new Set<() => void>();
  private disposed=false;
  public lastFailure?: {status:number;endpoint:string;message:string};
  public readonly metrics={requests:0,cacheHits:0,deduplicated:0,retries:0,timeouts:0};

  constructor(options: RequestOptions={}) {
    this.options={timeoutMs:15000,budgetMs:25000,retryDelayMs:600,cacheTTL:10*60*1000,maxConcurrent:4,maxQueued:64,...options};
  }

  clearCache(): void {this.cache.clear();this.cacheTimes.clear();}
  dispose(): void {
    this.disposed=true;
    for(const cancel of this.cancellers) cancel();
    this.cancellers.clear();this.clearCache();
    for(const resume of this.queue.splice(0)) resume();
  }

  private async limited<T>(run:()=>Promise<T>):Promise<T|undefined> {
    if(this.disposed) return undefined;
    if(this.active>=this.options.maxConcurrent) {
      if(this.queue.length>=this.options.maxQueued){this.lastFailure={status:0,endpoint:"scheduler",message:"Request queue capacity reached"};return undefined;}
      const admitted=await new Promise<boolean>(resolve=>{
        const resume=()=>{window.clearTimeout(timer);resolve(true);};
        const timer=window.setTimeout(()=>{const index=this.queue.indexOf(resume);if(index>=0)this.queue.splice(index,1);this.metrics.timeouts++;resolve(false);},this.options.budgetMs);
        this.queue.push(resume);
      });
      if(!admitted)return undefined;
    }
    if(this.disposed) return undefined;
    this.active++;
    try {return await run();} finally {this.active--;this.queue.shift()?.();}
  }

  // 遵守学术 API 规范的 Polite Headers
  private defaultHeaders: Record<string, string> = {
    "User-Agent": `ZoteroRefNexus/${version} (${homepage})`,
    "Accept": "application/json"
  };

  /**
   * 构造缓存键
   */
  private getCacheKey(method: string, url: string, extra?: any): string {
    return `${method}:${url}:${extra ? JSON.stringify(extra) : ""}`;
  }

  /**
   * 读取缓存项
   */
  public getCache(key: string): any {
    if (!this.cache.has(key)) {
      return undefined;
    }
    if(Date.now()-(this.cacheTimes.get(key)||0)>this.options.cacheTTL){this.cache.delete(key);this.cacheTimes.delete(key);return undefined;}
    this.metrics.cacheHits++;
    const value = this.cache.get(key);
    // Map keeps insertion order, so delete/reinsert moves the hit to MRU.
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  /**
   * 写入带容量上限的 LRU 缓存，防止内存无限膨胀
   */
  public setCache(key: string, value: any): void {
    if(this.disposed) return;
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    while (this.cache.size >= this.MAX_CACHE_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) break;
      this.cache.delete(oldestKey);
      this.cacheTimes.delete(oldestKey);
    }
    this.cache.set(key, value);
    this.cacheTimes.set(key,Date.now());
  }

  /**
   * 带超时和指数退避重试的执行器
   */
  private async executeWithRetry(
    method: "GET" | "POST",
    url: string,
    options: { responseType?: string; headers?: Record<string, string>; body?: string },
    maxRetries: number = 2
  ): Promise<any> {
    let attempt = 0;
    let delayMs = this.options.retryDelayMs;
    const deadline=Date.now()+this.options.budgetMs;

    while (attempt <= maxRetries && !this.disposed && Date.now()<deadline) {
      let timerId: any;
      let cancel: (()=>void)|undefined;
      let retryAfter=0;
      let retry=false;
      try {
        const timeout=Math.max(1,Math.min(this.options.timeoutMs,deadline-Date.now()));
        const timeoutPromise = new Promise<never>((_, reject) => {
          timerId = window.setTimeout(() => {this.metrics.timeouts++;cancel?.();reject(new Error(`Request timeout after ${timeout}ms`));}, timeout);
        });

        const reqPromise = Zotero.HTTP.request(method, url, {
          responseType: (options.responseType || "json") as any,
          headers: options.headers,
          body: options.body,
          timeout,
          noCache: false,
          successCodes: false,
          // Zotero defaults to retrying 429/5xx for up to an hour. This client
          // owns the bounded retry policy, so disable nested native retries.
          errorDelayMax: 0,
          cancellerReceiver: (fn:()=>void)=>{cancel=fn;this.cancellers.add(fn);if(this.disposed) fn();}
        } as any);
        this.metrics.requests++;

        const res = await Promise.race([reqPromise, timeoutPromise]);
        window.clearTimeout(timerId);

        if (res.status >= 200 && res.status < 300) {
          return res.response !== undefined ? res.response : res.responseText;
        }

        // 遇到 429 (Too Many Requests) 或 503 (Service Unavailable) 进行指数退避
        this.lastFailure={status:res.status,endpoint:url.split("?")[0],message:String(res.response?.message||res.response?.error||`HTTP ${res.status}`).slice(0,180)};
        retry=[429,500,502,503,504].includes(res.status);
        const header=res.getResponseHeader?.("Retry-After");
        if(header) retryAfter=/^\d+(?:\.\d+)?$/.test(header)?Number(header)*1000:Math.max(0,Date.parse(header)-Date.now());
        if(!retry) return undefined;
      } catch (err: any) {
        const status=Number(err?.status || err?.xmlhttp?.status || 0);
        this.lastFailure={status,endpoint:url.split("?")[0],message:String(err?.message||err?.name||"Network error").slice(0,180)};
        const timedOut=/timeout|timed out/i.test(`${err?.name} ${err?.message}`);
        retry=!timedOut && !this.disposed && (status===0 || [429,500,502,503,504].includes(status));
        ztoolkit.log(`[HTTP Error] ${method} ${url}:`, err);
      } finally {
        window.clearTimeout(timerId);
        if(cancel) this.cancellers.delete(cancel);
      }
      if(!retry || attempt>=maxRetries || this.disposed) return undefined;
      const wait=Math.max(delayMs,retryAfter);
      if(Date.now()+wait>=deadline) return undefined;
      this.metrics.retries++;attempt++;
      await Zotero.Promise.delay(wait);delayMs*=2;
    }
    return undefined;
  }

  /**
   * 发送 GET 请求
   */
  async get(url: string, responseType: string = "json", headers: Record<string, string> = {}): Promise<any> {
    const cacheKey = this.getCacheKey("GET", url, { responseType, headers });
    const cached = this.getCache(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    const pending = this.inFlight.get(cacheKey);
    if (pending) {this.metrics.deduplicated++;return pending;}

    const mergedHeaders = Object.assign({}, this.defaultHeaders, headers);
    const request = this.limited(()=>this.executeWithRetry("GET", url, {
      responseType,
      headers: mergedHeaders
    })).then(result => {
      if (result !== undefined) this.setCache(cacheKey, result);
      return result;
    }).finally(() => this.inFlight.delete(cacheKey));

    this.inFlight.set(cacheKey, request);
    return request;
  }

  /**
   * 发送 POST 请求
   */
  async post(url: string, body: object = {}, responseType: string = "json", headers: Record<string, string> = {}): Promise<any> {
    const mergedHeaders = Object.assign({
      "Content-Type": "application/json"
    }, this.defaultHeaders, headers);
    const cacheKey = this.getCacheKey("POST", url, { body, responseType, headers: mergedHeaders });
    const cached = this.getCache(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    const pending = this.inFlight.get(cacheKey);
    if (pending) {this.metrics.deduplicated++;return pending;}

    const request = this.limited(()=>this.executeWithRetry("POST", url, {
      responseType,
      headers: mergedHeaders,
      body: JSON.stringify(body)
    },0)).then(result => {
      if (result !== undefined) this.setCache(cacheKey, result);
      return result;
    }).finally(() => this.inFlight.delete(cacheKey));

    this.inFlight.set(cacheKey, request);
    return request;
  }

  /**
   * 规范化 DOI 解析路径，保留斜杠并在必要时对特殊字符编码
   */
  private formatDOIPath(doi: string): string {
    const cleanDOI = doi.trim().replace(/^https?:\/\/doi\.org\//i, "").replace(/^doi:\s*/i, "");
    return cleanDOI.split("/").map(seg => encodeURIComponent(seg)).join("/");
  }

  /**
   * RFC 5854 官方 DOI 内容协商 (Direct DOI Content Negotiation)
   * 由 DOI 官方解析至出版商服务器返回原生 BibTeX
   */
  async getBibTeXByDOI(doi: string): Promise<string | undefined> {
    const path = this.formatDOIPath(doi);
    const url = `https://doi.org/${path}`;
    return await this.get(url, "text", {
      "Accept": "application/x-bibtex; charset=utf-8"
    });
  }

  /**
   * RFC 5854 官方 DOI 获取标准 CSL-JSON
   */
  async getCSLJSONByDOI(doi: string): Promise<any | undefined> {
    const path = this.formatDOIPath(doi);
    const url = `https://doi.org/${path}`;
    return await this.get(url, "json", {
      "Accept": "application/vnd.citationstyles.csl+json"
    });
  }
}
