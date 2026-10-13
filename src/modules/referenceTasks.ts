export interface ReferenceTaskContext {
  signal: AbortSignal;
  pageIndex?: number;
  deadline?:number;
  isCurrent(): boolean;
}

/** One active operation per pane; stale operations cannot commit UI or cache state. */
export default class ReferenceTasks {
  private tasks = new Map<object, { key: string; controller: AbortController; promise: Promise<void> }>();
  private disposed = false;
  public readonly metrics={timeouts:0};
  constructor(private timeoutMs=90000){}

  run(target: object, key: string, perform: (context: ReferenceTaskContext) => Promise<void>,options:{onTimeout?:()=>void}={}): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const pending = this.tasks.get(target);
    if (pending?.key === key && !pending.controller.signal.aborted) return pending.promise;
    this.invalidate(target);
    const Controller=globalThis.AbortController;
    const controller: AbortController = new Controller();
    const task = { key, controller, promise: Promise.resolve() };
    this.tasks.set(target, task);
    const deadline=Date.now()+Math.max(1,this.timeoutMs);
    const expire=()=>{
      if(this.tasks.get(target)!==task||controller.signal.aborted)return;
      this.metrics.timeouts++;
      try{options.onTimeout?.();}catch(error){if(typeof ztoolkit!=="undefined")ztoolkit.log("Pane timeout cleanup failed",error);}
      finally{controller.abort();}
    };
    const timer=globalThis.setTimeout(expire,Math.max(1,this.timeoutMs));
    let release!:()=>void;
    const cancelled=new Promise<void>(resolve=>{release=resolve;controller.signal.addEventListener("abort",release,{once:true});});
    const work=Promise.resolve().then(() => controller.signal.aborted ? undefined : perform({
      signal: controller.signal,
      deadline,
      isCurrent: () => this.tasks.get(target) === task && !controller.signal.aborted && Date.now()<deadline
    }));
    task.promise=Promise.race([work,cancelled]).finally(() => {
      if(Date.now()>=deadline)expire();
      globalThis.clearTimeout(timer);controller.signal.removeEventListener("abort",release);
      if (this.tasks.get(target) === task) this.tasks.delete(target);
    });
    return task.promise;
  }

  invalidate(target: object): void {
    this.tasks.get(target)?.controller.abort();
    this.tasks.delete(target);
  }

  dispose(): void {
    this.disposed = true;
    for (const task of this.tasks.values()) task.controller.abort();
    this.tasks.clear();
  }

  get size(): number { return this.tasks.size; }
}
