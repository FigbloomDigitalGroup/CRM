import { afterEach, describe, expect, it } from "vitest";
import { GET } from "../src/app/api/metrics/route";

const req = (headers: Record<string, string> = {}) => new Request("http://localhost:3100/api/metrics", { headers });

describe("GET /api/metrics guard (P1.02)", () => {
  const saved = process.env.METRICS_TOKEN;
  afterEach(() => {
    if (saved === undefined) delete process.env.METRICS_TOKEN;
    else process.env.METRICS_TOKEN = saved;
  });

  it("is off (404) when no token is configured", async () => {
    delete process.env.METRICS_TOKEN;
    expect((await GET(req())).status).toBe(404);
  });

  it("rejects a missing or wrong token with 401", async () => {
    process.env.METRICS_TOKEN = "test-metrics-token";
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req({ authorization: "Bearer nope" }))).status).toBe(401);
  });
});
