export interface ReferenceTaskContext {
  signal: AbortSignal;
  isCurrent(): boolean;
}

/** One active operation per pane; stale operations cannot commit UI or cache state. */
export default class ReferenceTasks {
  private tasks = new Map<object, { key: string; controller: AbortController; promise: Promise<void> }>();

  run(target: object, key: string, perform: (context: ReferenceTaskContext) => Promise<void>): Promise<void> {
    const pending = this.tasks.get(target);
    if (pending?.key === key && !pending.controller.signal.aborted) return pending.promise;
    this.invalidate(target);
    const Controller=(window as any).AbortController || globalThis.AbortController;
    const controller: AbortController = new Controller();
    const task = { key, controller, promise: Promise.resolve() };
    this.tasks.set(target, task);
    task.promise = Promise.resolve().then(() => perform({
      signal: controller.signal,
      isCurrent: () => this.tasks.get(target) === task && !controller.signal.aborted
    })).finally(() => {
      if (this.tasks.get(target) === task) this.tasks.delete(target);
    });
    return task.promise;
  }

  invalidate(target: object): void {
    this.tasks.get(target)?.controller.abort();
    this.tasks.delete(target);
  }

  dispose(): void {
    for (const task of this.tasks.values()) task.controller.abort();
    this.tasks.clear();
  }

  get size(): number { return this.tasks.size; }
}
