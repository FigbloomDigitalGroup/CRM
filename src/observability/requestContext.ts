import { AsyncLocalStorage } from "node:async_hooks";

/** The request a log line belongs to (P1.02, FIG-1124). Set once per request by `instrumentRequest`; the logger reads it on every line. */
export type RequestContext = { requestId: string };

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
