import "./setup";
import { test, describe } from "node:test";
import assert from "node:assert";
import Requests from "../src/modules/requests";

describe("Requests Suite", () => {
  test("429 cools down all paths on one origin while a new key and other origins remain usable",async()=>{
    const original=Zotero.HTTP.request;let calls=0;
    Zotero.HTTP.request=async (_method:string,url:string,options:any)=>{calls++;return options.headers.Authorization||url.includes('other.test')?{status:200,response:{ok:true}}:{status:429,getResponseHeader:(name:string)=>name==='Retry-After'?'60':null};};
    const client=new Requests({budgetMs:100});
    try{await client.get('https://api.test/a');client.clearCache();assert.equal(await client.get('https://api.test/b'),undefined);assert.equal(calls,1);assert.equal(client.lastFailure?.status,429);assert.ok(client.lastFailure!.retryAfterMs!>0);assert.equal(client.metrics.cooldownHits,1);assert.deepEqual(await client.get('https://api.test/b','json',{Authorization:'Bearer fresh'}),{ok:true});assert.deepEqual(await client.get('https://other.test/a'),{ok:true});assert.equal(calls,3);}finally{client.dispose();Zotero.HTTP.request=original;}
  });
  test("daily-budget headers prevent retrying before reset",async()=>{
    const original=Zotero.HTTP.request;let calls=0;
    Zotero.HTTP.request=async()=>{calls++;return {status:429,getResponseHeader:(name:string)=>name==='X-RateLimit-Remaining'?'0':name==='X-RateLimit-Reset'?'3600':null};};
    const client=new Requests({budgetMs:100,retryDelayMs:1});
    try{await client.get('https://api.test/daily');assert.equal(calls,1);assert.ok(client.lastFailure!.retryAfterMs!>=3600000);await client.get('https://api.test/another');assert.equal(calls,1);}finally{client.dispose();Zotero.HTTP.request=original;}
  });
  test("expired cooldowns automatically recover",async()=>{
    const original=Zotero.HTTP.request;let calls=0;
    Zotero.HTTP.request=async()=>++calls===1?{status:429,getResponseHeader:()=>null}:{status:200,response:{ok:true}};
    const client=new Requests({budgetMs:5,retryDelayMs:20});
    try{await client.get('https://api.test/expire');await new Promise(resolve=>setTimeout(resolve,30));assert.deepEqual(await client.get('https://api.test/expire'),{ok:true});assert.equal(calls,2);}finally{client.dispose();Zotero.HTTP.request=original;}
  });
  test("disposal releases active and queued requests even when transport cancellation never settles",async()=>{
    const original=Zotero.HTTP.request;let cancelled=0;
    Zotero.HTTP.request=async (_method:string,_url:string,options:any)=>{options.cancellerReceiver(()=>cancelled++);return new Promise(()=>{});};
    const client=new Requests({maxConcurrent:1,timeoutMs:10000});
    try{const active=client.get('https://api.test/active'),queued=client.get('https://api.test/queued');client.dispose();assert.deepEqual(await Promise.all([active,queued]),[undefined,undefined]);assert.equal(cancelled,1);assert.equal((client as any).active,0);assert.equal((client as any).queue.length,0);assert.equal((client as any).inFlight.size,0);}finally{Zotero.HTTP.request=original;}
  });
  test("disposal interrupts retry backoff immediately",async()=>{
    const original=Zotero.HTTP.request;Zotero.HTTP.request=async()=>({status:503});
    const client=new Requests({retryDelayMs:10000});
    try{const pending=client.get('https://api.test/backoff');await new Promise(resolve=>setTimeout(resolve,5));const start=Date.now();client.dispose();await pending;assert.ok(Date.now()-start<200);assert.equal(client.metrics.requests,1);}finally{Zotero.HTTP.request=original;}
  });
  test("queue waiting consumes the original total budget",async()=>{
    const original=Zotero.HTTP.request;const timeouts:number[]=[];
    Zotero.HTTP.request=async (_method:string,url:string,options:any)=>{timeouts.push(options.timeout);if(url.endsWith('/a'))await new Promise(resolve=>setTimeout(resolve,50));return {status:200,response:{ok:true}};};
    const client=new Requests({maxConcurrent:1,budgetMs:100,timeoutMs:100});
    try{await Promise.all([client.get('https://api.test/a'),client.get('https://api.test/b')]);assert.equal(timeouts.length,2);assert.ok(timeouts[1]<75,`Queued request received ${timeouts[1]}ms`);}finally{client.dispose();Zotero.HTTP.request=original;}
  });
  test("does not retry permanent 404 errors or enable Zotero's nested hour-long retries",async()=>{
    const original=Zotero.HTTP.request;let calls=0;
    Zotero.HTTP.request=async (_method:string,_url:string,options:any)=>{
      calls++;assert.equal(options.errorDelayMax,0);assert.equal(options.successCodes,false);return {status:404};
    };
    try{assert.equal(await new Requests().get('https://api.test/missing'),undefined);assert.equal(calls,1);}finally{Zotero.HTTP.request=original;}
  });
  test("honors a Retry-After that exceeds the operation budget without retrying early",async()=>{
    const original=Zotero.HTTP.request;let calls=0;
    Zotero.HTTP.request=async()=>{calls++;return {status:429,getResponseHeader:()=> '60'};};
    try{assert.equal(await new Requests({budgetMs:100,retryDelayMs:1}).get('https://api.test/throttle'),undefined);assert.equal(calls,1);}finally{Zotero.HTTP.request=original;}
  });
  test("a timed-out request is physically cancelled and is not cached",async()=>{
    const original=Zotero.HTTP.request;let cancelled=0;
    Zotero.HTTP.request=async (_method:string,_url:string,options:any)=>{options.cancellerReceiver(()=>cancelled++);return new Promise(()=>{});};
    try{const client=new Requests({timeoutMs:10,budgetMs:100});assert.equal(await client.get('https://api.test/stall'),undefined);assert.equal(cancelled,1);assert.equal((client as any).cache.size,0);}finally{Zotero.HTTP.request=original;}
  });
  test("distinct requests have bounded concurrency",async()=>{
    const original=Zotero.HTTP.request;let active=0,max=0;
    Zotero.HTTP.request=async()=>{active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,5));active--;return {status:200,response:{ok:true}};};
    try{const client=new Requests({maxConcurrent:2});await Promise.all(Array.from({length:8},(_,i)=>client.get(`https://api.test/task${i}`)));assert.equal(max,2);}finally{Zotero.HTTP.request=original;}
  });
  test("a new arrival cannot steal a slot reserved for a queued request",async()=>{
    const original=Zotero.HTTP.request;let active=0,maximum=0,newcomer:Promise<any>|undefined;
    Zotero.HTTP.request=async()=>{active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setTimeout(resolve,5));active--;return {status:200,response:{ok:true}};};
    const client=new Requests({maxConcurrent:1});
    try{const first=client.get('https://api.test/fair-a'),second=client.get('https://api.test/fair-b');const resume=(client as any).queue[0];(client as any).queue[0]=()=>{resume();newcomer=client.get('https://api.test/fair-c');};await Promise.all([first,second]);await newcomer;assert.equal(maximum,1);}finally{client.dispose();Zotero.HTTP.request=original;}
  });
  test("should promote cache hits before evicting the least recently used entry", () => {
    const requests = new Requests();
    // Fill cache with MAX_CACHE_ENTRIES
    for (let i = 0; i < 500; i++) {
      requests.setCache(`key_${i}`, `val_${i}`);
    }
    assert.strictEqual(requests.getCache("key_0"), "val_0");
    assert.strictEqual(requests.getCache("key_499"), "val_499");

    // Add 501st entry - key_0 was accessed, but key_1 is now oldest
    requests.setCache("key_500", "val_500");
    // Size should still be 500
    assert.strictEqual((requests as any).cache.size, 500);
    assert.strictEqual(requests.getCache("key_500"), "val_500");
    assert.strictEqual(requests.getCache("key_0"), "val_0");
    assert.strictEqual(requests.getCache("key_1"), undefined);
  });

  test("should properly format DOI path for content negotiation", () => {
    const requests = new Requests();
    const formatted = (requests as any).formatDOIPath("10.1038/s41586-020-2649-2");
    assert.strictEqual(formatted, "10.1038/s41586-020-2649-2");

    const formattedWithPrefix = (requests as any).formatDOIPath("https://doi.org/10.1038/s41586-020-2649-2");
    assert.strictEqual(formattedWithPrefix, "10.1038/s41586-020-2649-2");
  });

  test("should retrieve cached value without re-querying", async () => {
    const requests = new Requests();
    const cacheKey = (requests as any).getCacheKey("GET", "https://api.test/cached", { responseType: "json", headers: {} });
    requests.setCache(cacheKey, { cached: true });

    const result = await requests.get("https://api.test/cached");
    assert.deepStrictEqual(result, { cached: true });
  });

  test("should deduplicate concurrent identical GET requests", async () => {
    const requests = new Requests();
    const originalRequest = Zotero.HTTP.request;
    let calls = 0;
    Zotero.HTTP.request = async () => {
      calls++;
      await new Promise(resolve => setTimeout(resolve, 10));
      return { status: 200, response: { shared: true } };
    };

    try {
      const [first, second] = await Promise.all([
        requests.get("https://api.test/shared"),
        requests.get("https://api.test/shared")
      ]);
      assert.deepStrictEqual(first, { shared: true });
      assert.deepStrictEqual(second, { shared: true });
      assert.strictEqual(calls, 1);
    } finally {
      Zotero.HTTP.request = originalRequest;
    }
  });

  test("should keep POST response types and headers isolated in the cache", async () => {
    const requests = new Requests();
    const originalRequest = Zotero.HTTP.request;
    const responseTypes: string[] = [];
    Zotero.HTTP.request = async (_method: string, _url: string, options: any) => {
      responseTypes.push(options.responseType);
      return { status: 200, response: options.responseType };
    };

    try {
      assert.strictEqual(await requests.post("https://api.test/post", { q: 1 }, "json"), "json");
      assert.strictEqual(await requests.post("https://api.test/post", { q: 1 }, "text"), "text");
      assert.deepStrictEqual(responseTypes, ["json", "text"]);
    } finally {
      Zotero.HTTP.request = originalRequest;
    }
  });
});


test("scheduler bounds queued requests and expires waiting work", async()=>{
  const original=Zotero.HTTP.request;let release:any;Zotero.HTTP.request=async()=>new Promise(resolve=>{release=resolve;});
  const requests=new Requests({maxConcurrent:1,maxQueued:1,budgetMs:30,timeoutMs:30});
  try{const active=requests.get("https://fixture/queue-a");const queued=requests.get("https://fixture/queue-b");const overflow=await requests.get("https://fixture/queue-c");assert.equal(overflow,undefined);assert.equal((requests as any).queue.length,1);assert.equal(await queued,undefined);assert.equal((requests as any).queue.length,0);release?.({status:200,response:{ok:true}});await active;}finally{requests.dispose();Zotero.HTTP.request=original;}
});
