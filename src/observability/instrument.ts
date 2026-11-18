import { headers } from "next/headers";
import { newRequestId } from "@/lib/apiErrors";
import { recordRequest, routeGroup } from "./metrics";
import { runWithRequestContext } from "./requestContext";

/**
 * Wraps one API request (P1.02, FIG-1124): puts the request id in the logging
 * context so every log line written while it runs carries `requestId`, and
 * records count and latency for /api/metrics. `handleRoute` calls this around
 * its work; the status is read from the finished response (a thrown error counts as 500).
 * The path and method come from the middleware's `x-fb-*` headers.
 */
export async function instrumentRequest<T extends { status: number }>(fn: () => Promise<T>): Promise<T> {
  let requestId = newRequestId();
  let method = "GET";
  let route = "/api/other";
  try {
    const h = await headers();
    requestId = newRequestId(h.get("x-request-id"));
    method = h.get("x-fb-method") ?? method;
    const path = h.get("x-fb-path");
    if (path) route = routeGroup(path);
  } catch {
    // outside a request (unit tests): keep the fresh id
  }
  const started = performance.now();
  let status = 500;
  try {
    const res = await runWithRequestContext({ requestId }, fn);
    status = res.status;
    return res;
  } finally {
    recordRequest({ method, route, status, durationMs: performance.now() - started });
  }
}
