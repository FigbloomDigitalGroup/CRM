import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../src/auth/context";
import { setOrganizationRelease } from "../src/services/featureService";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";

const current: { ctx: AuthContext | null } = { ctx: null };
vi.mock("../src/auth/requestContext", () => ({
  resolveRequestContext: async () => {
    if (!current.ctx) throw new Error("no ctx");
    return current.ctx;
  },
}));

import * as quoteVersionRoute from "../src/app/api/orgs/[orgSlug]/quotes/[quoteId]/versions/[version]/route";
import * as quoteSendRoute from "../src/app/api/orgs/[orgSlug]/quotes/[quoteId]/versions/[version]/send/route";
import * as quoteResponseRoute from "../src/app/api/orgs/[orgSlug]/quotes/[quoteId]/versions/[version]/response/route";
import * as sequencesRoute from "../src/app/api/orgs/[orgSlug]/sequences/route";
import * as dismissRoute from "../src/app/api/orgs/[orgSlug]/assistant/proposals/[proposalId]/dismiss/route";

/**
 * Release gate on the V1.1 routes: the gate answers before the version param, the body or the record is looked at,
 * so a V1 organisation always gets 403 FEATURE_UNAVAILABLE and a V1.1 one reaches the normal answer.
 */
const NIL = "00000000-0000-4000-8000-000000000000";
const savedRelease = process.env.ACTIVE_RELEASE;
beforeEach(() => {
  delete process.env.ACTIVE_RELEASE;
  current.ctx = null;
});
afterEach(() => {
  if (savedRelease === undefined) delete process.env.ACTIVE_RELEASE;
  else process.env.ACTIVE_RELEASE = savedRelease;
});

const post = (body: unknown) => new Request("http://x.test/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const params = (extra: Record<string, string> = {}) => ({ params: Promise.resolve({ orgSlug: "x", quoteId: NIL, version: "1", proposalId: NIL, ...extra }) });

async function world(release: "v1" | "v1.1") {
  const org = await createTestOrganization("Gate");
  await setOrganizationRelease(org.id, release);
  current.ctx = await createTestContext(org.id, "MANAGEMENT", "gate.mgmt");
}

describe("V1.1 routes behind the release gate", () => {
  it("a V1 organisation gets FEATURE_UNAVAILABLE before validation or lookup", async () => {
    await world("v1");
    const answers = [
      await quoteVersionRoute.GET(new Request("http://x.test/api"), params({ version: "not-a-number" })),
      await quoteVersionRoute.PUT(new Request("http://x.test/api", { method: "PUT", body: "{}" }), params()),
      await quoteSendRoute.POST(post({ bogus: true }), params()),
      await quoteResponseRoute.POST(post({}), params()),
      await sequencesRoute.POST(post({}), params()),
      await dismissRoute.POST(post({}), params()),
    ];
    for (const res of answers) {
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe("FEATURE_UNAVAILABLE");
    }
  });

  it("a V1.1 organisation reaches the normal answers", async () => {
    await world("v1.1");
    expect((await quoteVersionRoute.GET(new Request("http://x.test/api"), params())).status).toBe(404);
    expect((await sequencesRoute.POST(post({}), params())).status).toBe(400);
  });
});
