/** Provider/credential-scoped admission across every HTTP client in this plugin instance. */
export class SharedRequestScheduler {
  private scopes=new Map<string,{active:number;limit:number;queue:Array<()=>void>}>();
  get usage(){let active=0,queued=0;for(const scope of this.scopes.values()){active+=scope.active;queued+=scope.queue.length;}return {scopes:this.scopes.size,active,queued};}
  async run<T>(key:string,job:()=>Promise<T>,deadline:number,signal?:AbortSignal,limit=4):Promise<T|undefined>{
    if(signal?.aborted||Date.now()>=deadline)return;
    let scope=this.scopes.get(key);if(!scope){scope={active:0,limit,queue:[]};this.scopes.set(key,scope);}else scope.limit=Math.min(scope.limit,limit);
    const entry=scope;
    const trim=()=>{if(!entry.active&&!entry.queue.length&&this.scopes.get(key)===entry)this.scopes.delete(key);};
    if(entry.active>=entry.limit){
      if(entry.queue.length>=128)return;
      const admitted=await new Promise<boolean>(resolve=>{
        const cleanup=()=>{globalThis.clearTimeout(timer);signal?.removeEventListener('abort',abort);};
        const resume=()=>{cleanup();if(signal?.aborted||Date.now()>=deadline){resolve(false);if(entry.active<entry.limit)entry.queue.shift()?.();trim();return;}entry.active++;resolve(true);};
        const abort=()=>{const index=entry.queue.indexOf(resume);if(index>=0)entry.queue.splice(index,1);cleanup();resolve(false);trim();};
        const timer=globalThis.setTimeout(abort,Math.max(1,deadline-Date.now()));entry.queue.push(resume);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
      });if(!admitted)return;
    }else entry.active++;
    try{return signal?.aborted||Date.now()>=deadline?undefined:await job();}
    finally{entry.active--;if(entry.active<entry.limit)entry.queue.shift()?.();trim();}
  }
}
