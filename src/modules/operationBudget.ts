/** One deadline for a whole provider operation, including lookup, queues and pages. */
export class OperationBudget {
  private controller=new AbortController();
  private timer:ReturnType<typeof globalThis.setTimeout>;
  private stopped:Promise<undefined>;
  private stop!:()=>void;
  private forward=()=>this.controller.abort();
  private closed=false;
  readonly deadline:number;
  constructor(private parent?:AbortSignal,timeoutMs=25000) {
    this.deadline=Date.now()+Math.max(1,timeoutMs);
    this.stopped=new Promise(resolve=>{this.stop=()=>resolve(undefined);});
    this.controller.signal.addEventListener("abort",this.stop,{once:true});
    parent?.addEventListener("abort",this.forward,{once:true});
    this.timer=globalThis.setTimeout(this.forward,Math.max(1,timeoutMs));
    if(parent?.aborted)this.forward();
  }
  get signal(){return this.controller.signal;}
  get expired(){return this.closed || this.signal.aborted || Date.now()>=this.deadline;}
  checkCancelled(){if(this.parent?.aborted){const error=new Error("Operation cancelled");error.name="AbortError";throw error;}}
  async run<T>(operation:(signal:AbortSignal)=>Promise<T>):Promise<T|undefined> {
    this.checkCancelled();
    if(this.expired)return;
    // Defer invocation so cancellation before the next microtask never starts I/O.
    const work=Promise.resolve().then(()=>this.expired?undefined:operation(this.signal));
    const result=await Promise.race([work,this.stopped]);
    this.checkCancelled();
    return this.expired?undefined:result;
  }
  dispose(){this.closed=true;globalThis.clearTimeout(this.timer);this.parent?.removeEventListener("abort",this.forward);this.controller.abort();this.controller.signal.removeEventListener("abort",this.stop);}
}
