import { Writable } from "node:stream";
import pino from "pino";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { REDACTED_PATHS } from "../src/lib/logger";
import { middleware } from "../src/middleware";
import { recordRequest, renderMetrics, resetMetrics, routeGroup } from "../src/observability/metrics";
import { currentRequestContext, runWithRequestContext } from "../src/observability/requestContext";

const APP = "http://localhost:3100";
const get = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(`${APP}${path}`, { method: "GET", headers: { host: "localhost:3100", ...headers } });

describe("request id middleware (P1.02)", () => {
  it("adds a request id to the response and forwards it to the route", () => {
    const res = middleware(get("/api/orgs/acme/deals"));
    const id = res.headers.get("x-request-id");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers.get("x-middleware-request-x-request-id")).toBe(id);
    expect(res.headers.get("x-middleware-request-x-fb-path")).toBe("/api/orgs/acme/deals");
  });

  it("keeps a usable id from the caller and replaces an unsafe one", () => {
    expect(middleware(get("/api/me/x", { "x-request-id": "trace-abc-12345" })).headers.get("x-request-id")).toBe("trace-abc-12345");
    const bad = middleware(get("/api/me/x", { "x-request-id": "bad id with spaces" })).headers.get("x-request-id");
    expect(bad).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("request context in log lines (P1.02)", () => {
  it("is visible inside a request and gone outside", () => {
    expect(currentRequestContext()).toBeUndefined();
    runWithRequestContext({ requestId: "req-12345678" }, () => expect(currentRequestContext()?.requestId).toBe("req-12345678"));
    expect(currentRequestContext()).toBeUndefined();
  });

  it("the logger's redaction list hides secrets and masked values", () => {
    const lines: string[] = [];
    const sink = new Writable({ write(chunk, _e, cb) { lines.push(String(chunk)); cb(); } });
    const log = pino({ redact: { paths: REDACTED_PATHS, censor: "[redacted]" } }, sink);
    log.info({ token: "t0ps3cret", deal: { dealValue: 91234, margin: 0.31 }, headers: { authorization: "Bearer abc" } }, "x");
    const out = lines.join("");
    for (const leaked of ["t0ps3cret", "91234", "0.31", "Bearer abc"]) expect(out).not.toContain(leaked);
  });
});

describe("metrics (P1.02)", () => {
  beforeEach(() => resetMetrics());

  it("groups ids out of routes", () => {
    expect(routeGroup("/api/orgs/acme/deals/7f3c1a2b-1111-2222-3333-444455556666/notes")).toBe("/api/orgs/:org/deals/:id/notes");
  });

  it("counts requests by status class and builds a latency histogram", () => {
    recordRequest({ method: "get", route: "/api/orgs/:org/deals", status: 200, durationMs: 40 });
    recordRequest({ method: "get", route: "/api/orgs/:org/deals", status: 500, durationMs: 3000 });
    const text = renderMetrics();
    expect(text).toContain('figbloom_http_requests_total{method="GET",route="/api/orgs/:org/deals",status="2xx"} 1');
    expect(text).toContain('status="5xx"} 1');
    expect(text).toContain('figbloom_http_request_duration_seconds_bucket{method="GET",route="/api/orgs/:org/deals",le="0.05"} 1');
    expect(text).toContain('le="+Inf"} 2');
    expect(text).toContain("_count{method=\"GET\",route=\"/api/orgs/:org/deals\"} 2");
  });

  it("renders job queue gauges, including lag", () => {
    const text = renderMetrics([{ type: "notifications.sweep", queued: 3, running: 1, dead: 0, oldestDueSeconds: 420 }]);
    expect(text).toContain('figbloom_job_lag_seconds{type="notifications.sweep"} 420');
    expect(text).toContain('figbloom_jobs_queued{type="notifications.sweep"} 3');
  });
});
