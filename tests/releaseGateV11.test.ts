import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../src/auth/context";
import { adminDb } from "../src/db/adminClient";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";

// Mail, meetings, connections, business-card capture and the two-step admin routes are V1.1 features: an organisation on
// release V1 gets 403 FEATURE_UNAVAILABLE before anything else (validation, record lookup, permission), a V1.1 one works.
const current: { ctx: AuthContext | null } = { ctx: null };
vi.mock("../src/auth/requestContext", () => ({
  resolveRequestContext: async () => current.ctx,
}));

import { GET as listDrafts, POST as createDraft } from "../src/app/api/orgs/[orgSlug]/communications/mail/drafts/route";
import { POST as scheduleMeeting } from "../src/app/api/orgs/[orgSlug]/communications/meetings/route";
import { GET as listConnections } from "../src/app/api/orgs/[orgSlug]/integrations/connections/route";
import { POST as startCapture } from "../src/app/api/orgs/[orgSlug]/quick-capture/cards/route";
import { GET as getPolicy } from "../src/app/api/orgs/[orgSlug]/security/two-step-policy/route";
import { POST as resetTwoStep } from "../src/app/api/orgs/[orgSlug]/memberships/[membershipId]/two-step-reset/route";

const ORIGINAL_RELEASE = process.env.ACTIVE_RELEASE;
let orgId = "";
afterAll(async () => {
  if (ORIGINAL_RELEASE === undefined) delete process.env.ACTIVE_RELEASE;
  else process.env.ACTIVE_RELEASE = ORIGINAL_RELEASE;
  if (orgId) await adminDb.organization.deleteMany({ where: { id: orgId } });
});
beforeAll(async () => {
  process.env.ACTIVE_RELEASE = "v1.1";
  const org = await createTestOrganization("ReleaseGate");
  orgId = org.id;
  current.ctx = await createTestContext(org.id, "MANAGEMENT", "gate.mgmt");
});

const req = (method: string, body?: unknown) =>
  new Request("http://localhost/api/x", { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const params = <T extends Record<string, string> = Record<string, never>>(extra?: T) => ({ params: Promise.resolve({ orgSlug: "x", ...(extra ?? ({} as T)) }) });

// A deliberately invalid body: the gate must answer before validation.
const CALLS: Record<string, () => Promise<Response>> = {
  mail: () => createDraft(req("POST", { nonsense: true }), params()),
  mailList: () => listDrafts(req("GET"), params()),
  meetings: () => scheduleMeeting(req("POST", { nonsense: true }), params()),
  connections: () => listConnections(req("GET"), params()),
  quickCapture: () => startCapture(req("POST", { nonsense: true }), params()),
  twoStepPolicy: () => getPolicy(req("GET"), params()),
  twoStepReset: () => resetTwoStep(req("POST"), params({ membershipId: "does-not-exist" })),
};

describe("V1.1 release gate on mail, meetings, connections, card capture and two-step admin", () => {
  for (const [name, call] of Object.entries(CALLS)) {
    it(`${name}: V1 organisation gets FEATURE_UNAVAILABLE`, async () => {
      process.env.ACTIVE_RELEASE = "v1";
      try {
        const res = await call();
        expect(res.status).toBe(403);
        expect((await res.json()).code).toBe("FEATURE_UNAVAILABLE");
      } finally {
        process.env.ACTIVE_RELEASE = "v1.1";
      }
    });
  }

  it("a V1.1 organisation reaches the service (lists work, bad input gets its own answer)", async () => {
    for (const name of ["mailList", "connections", "twoStepPolicy"]) {
      expect((await CALLS[name]!()).status, name).toBe(200);
    }
    for (const name of ["mail", "meetings", "quickCapture", "twoStepReset"]) {
      const res = await CALLS[name]!();
      const body = await res.json();
      expect(body.code, name).not.toBe("FEATURE_UNAVAILABLE");
      expect(res.status, name).toBeGreaterThanOrEqual(400);
    }
  });
});
