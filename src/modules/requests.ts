/**
 * 健壮的学术网络请求器 (Robust Academic HTTP Client)
 * 具备请求超时控制、429/503 指数退避自动重试、500项 LRU 内存容量限制与 RFC 5854 内容协商支持
 */

export default class Requests {
  private cache: Map<string, any> = new Map();
  private inFlight: Map<string, Promise<any>> = new Map();
  private readonly MAX_CACHE_ENTRIES: number = 500;
  private readonly TIMEOUT_MS: number = 15000;

  // 遵守学术 API 规范的 Polite Headers
  private defaultHeaders: Record<string, string> = {
    "User-Agent": "ZoteroRefNexus/10.0.0 (https://github.com/muisedestiny/zotero-refnexus; mailto:polite@zotero-ref.org)",
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
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    while (this.cache.size >= this.MAX_CACHE_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) break;
      this.cache.delete(oldestKey);
    }
    this.cache.set(key, value);
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
    let delayMs = 600;

    while (attempt <= maxRetries) {
      let timerId: any;
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timerId = window.setTimeout(() => reject(new Error(`Request timeout after ${this.TIMEOUT_MS}ms`)), this.TIMEOUT_MS);
        });

        const reqPromise = Zotero.HTTP.request(method, url, {
          responseType: (options.responseType || "json") as any,
          headers: options.headers,
          body: options.body,
          timeout: this.TIMEOUT_MS,
          noCache: false
        });

        const res = await Promise.race([reqPromise, timeoutPromise]);
        window.clearTimeout(timerId);

        if (res.status >= 200 && res.status < 300) {
          return res.response !== undefined ? res.response : res.responseText;
        }

        // 遇到 429 (Too Many Requests) 或 503 (Service Unavailable) 进行指数退避
        if ((res.status === 429 || res.status === 503) && attempt < maxRetries) {
          attempt++;
          ztoolkit.log(`[HTTP ${res.status}] Rate limit on ${url}, retrying in ${delayMs}ms (attempt ${attempt}/${maxRetries})...`);
          await new Promise(r => window.setTimeout(r, delayMs));
          delayMs *= 2;
          continue;
        }

        ztoolkit.log(`[HTTP ${res.status}] ${method} ${url}`);
        return undefined;
      } catch (err: any) {
        window.clearTimeout(timerId);
        attempt++;
        if (attempt <= maxRetries && !err?.message?.includes("timeout")) {
          await new Promise(r => window.setTimeout(r, delayMs));
          delayMs *= 2;
          continue;
        }
        ztoolkit.log(`[HTTP Error] ${method} ${url}:`, err);
        return undefined;
      }
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
    if (pending) return pending;

    const mergedHeaders = Object.assign({}, this.defaultHeaders, headers);
    const request = this.executeWithRetry("GET", url, {
      responseType,
      headers: mergedHeaders
    }).then(result => {
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
    if (pending) return pending;

    const request = this.executeWithRetry("POST", url, {
      responseType,
      headers: mergedHeaders,
      body: JSON.stringify(body)
    }).then(result => {
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
