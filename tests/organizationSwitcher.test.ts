import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { NotFoundError, ValidationError } from "../src/auth/errors";
import { SESSION_COOKIE_NAME, createSession, lookupSession, revokeSession } from "../src/auth/session";
import { adminDb } from "../src/db/adminClient";
import { withOrgContext } from "../src/db/orgScopedClient";
import { listMyOrganizations, switchOrganization } from "../src/services/organizationSwitcherService";
import { createTestOrganization, createTestUser } from "./helpers/fixtures";

/**
 * FIG-1133 (B6.01): one person in several organisations, the switcher API,
 * and the cross-organisation attacks around it.
 */
const holder = vi.hoisted(() => ({ jar: { get: (_n: string): { value: string } | undefined => undefined } }));
vi.mock("next/headers", () => ({ cookies: async () => holder.jar, headers: async () => new Headers() }));

const orgIds: string[] = [];
afterEach(() => {
  holder.jar = { get: () => undefined };
});
afterAll(async () => {
  await adminDb.organization.deleteMany({ where: { id: { in: orgIds } } });
});

async function join(userId: string, organizationId: string, roleKey: string) {
  const role = await adminDb.role.findUniqueOrThrow({ where: { key: roleKey } });
  return adminDb.membership.create({ data: { organizationId, userId, roleId: role.id, joinedAt: new Date() } });
}

/** A person in organisations A (Management) and B (Sales), signed in under A. */
async function twoOrgPerson() {
  const a = await createTestOrganization("SwitchA");
  const b = await createTestOrganization("SwitchB");
  orgIds.push(a.id, b.id);
  const user = await createTestUser("multi.org");
  const ma = await join(user.id, a.id, "MANAGEMENT");
  const mb = await join(user.id, b.id, "SALES");
  const created = await createSession(user.id, { client: { userAgent: "Mozilla/5.0 Chrome/120" }, organizationId: a.id });
  const row = await adminDb.session.findUniqueOrThrow({ where: { id: created.sessionId } });
  return { a, b, user, ma, mb, created, row };
}

describe("listing", () => {
  it("shows only the person's own active memberships, with the role in each and the open one marked", async () => {
    const { a, b, user, row } = await twoOrgPerson();
    const other = await createTestOrganization("NotMine");
    orgIds.push(other.id);
    const stranger = await createTestUser("stranger");
    await join(stranger.id, other.id, "MANAGEMENT");
    const list = await listMyOrganizations(user.id, row.organizationId);
    expect(list.items.map((i) => [i.slug, i.roleKey, i.current])).toEqual([[a.slug, "MANAGEMENT", true], [b.slug, "SALES", false]]);
    expect(list.currentSlug).toBe(a.slug);
    expect(JSON.stringify(list)).not.toContain(other.slug);
    // each item holds only these fields: nothing else about an organisation
    expect(Object.keys(list.items[0]!).sort()).toEqual(["current", "membershipId", "name", "roleKey", "roleName", "slug"]);
  });

  it("leaves out an organisation where the person is deactivated or removed, and one that is inactive", async () => {
    const { b, user, mb, row } = await twoOrgPerson();
    await adminDb.membership.update({ where: { id: mb.id }, data: { status: "INACTIVE" } });
    expect((await listMyOrganizations(user.id, row.organizationId)).items).toHaveLength(1);
    await adminDb.membership.update({ where: { id: mb.id }, data: { status: "ACTIVE" } });
    await adminDb.organization.update({ where: { id: b.id }, data: { status: "INACTIVE" } });
    expect((await listMyOrganizations(user.id, row.organizationId)).items).toHaveLength(1);
    await adminDb.organization.update({ where: { id: b.id }, data: { status: "ACTIVE" } });
  });

  it("is a list of one for a single-organisation person, who is unaffected (V1)", async () => {
    const a = await createTestOrganization("Solo");
    orgIds.push(a.id);
    const user = await createTestUser("solo");
    await join(user.id, a.id, "SALES");
    const s = await createSession(user.id, { client: { userAgent: "x" } });
    const row = await adminDb.session.findUniqueOrThrow({ where: { id: s.sessionId } });
    expect((await listMyOrganizations(user.id, row.organizationId)).items).toHaveLength(1);
    const ctx = await switchOrganization({ userId: user.id, session: row, orgSlug: a.slug });
    expect(ctx.organisation?.slug).toBe(a.slug);
    expect(await adminDb.auditEvent.count({ where: { organizationId: a.id, action: "auth.org_switched" } })).toBe(0);
  });
});

describe("switching", () => {
  it("moves the session to the other organisation and returns that organisation's role, permissions, look and features at once", async () => {
    const { a, b, user, row } = await twoOrgPerson();
    const before = await switchOrganization({ userId: user.id, session: row, orgSlug: a.slug });
    expect(before.role?.key).toBe("MANAGEMENT");
    const after = await switchOrganization({ userId: user.id, session: row, orgSlug: b.slug });
    expect(after.organisation?.slug).toBe(b.slug);
    expect(after.role?.key).toBe("SALES");
    expect(after.permissions).not.toEqual(before.permissions);
    expect(after.permissions).not.toContain("security.manage");
    expect(after.membership?.id).not.toBe(before.membership?.id);
    expect(after.organisations.filter((o) => o.current).map((o) => o.slug)).toEqual([b.slug]);
    const saved = await adminDb.session.findUniqueOrThrow({ where: { id: row.id } });
    expect(saved.organizationId).toBe(b.id);
    // the next context read, from the stored session, also lands in B (nothing is stale)
    const { getMemberContext } = await import("../src/services/meContextService");
    expect((await getMemberContext({ userId: user.id, session: saved })).role?.key).toBe("SALES");
    // and back again
    expect((await switchOrganization({ userId: user.id, session: saved, orgSlug: a.slug })).role?.key).toBe("MANAGEMENT");
  });

  it("audits the move in both organisations, each entry free of the other organisation", async () => {
    const { a, b, user, row } = await twoOrgPerson();
    await switchOrganization({ userId: user.id, session: row, orgSlug: b.slug });
    const inA = await adminDb.auditEvent.findMany({ where: { organizationId: a.id, action: "auth.org_switched" } });
    const inB = await adminDb.auditEvent.findMany({ where: { organizationId: b.id, action: "auth.org_switched" } });
    expect(inA.map((e) => e.metadata)).toEqual([{ direction: "left" }]);
    expect(inB.map((e) => e.metadata)).toEqual([{ direction: "entered" }]);
    expect(JSON.stringify(inA)).not.toContain(b.slug);
    expect(JSON.stringify(inB)).not.toContain(a.slug);
    expect(inA[0]!.actorMembershipId).not.toBe(inB[0]!.actorMembershipId);
  });

  it("changes data scope with the organisation: RLS shows each organisation only its own rows, whichever one is open", async () => {
    const { a, b, user } = await twoOrgPerson();
    const { createCompany } = await import("../src/repositories/companies");
    await createCompany({ organizationId: a.id, name: `Only in A ${randomUUID().slice(0, 6)}` });
    const countIn = (orgId: string) => withOrgContext(orgId, (tx) => tx.company.count());
    expect(await countIn(a.id)).toBe(1);
    expect(await countIn(b.id)).toBe(0);
    void user;
  });
});

describe("cross-organisation attacks", () => {
  it("answers a slug the person is not a member of exactly like an unknown slug, and leaves the session where it was", async () => {
    const a = await createTestOrganization("AttackA");
    const victim = await createTestOrganization("AttackVictim");
    orgIds.push(a.id, victim.id);
    const user = await createTestUser("attacker");
    await join(user.id, a.id, "MANAGEMENT");
    const s = await createSession(user.id, { client: { userAgent: "x" }, organizationId: a.id });
    const row = await adminDb.session.findUniqueOrThrow({ where: { id: s.sessionId } });
    const real = await switchOrganization({ userId: user.id, session: row, orgSlug: victim.slug }).catch((e: Error) => e);
    const fake = await switchOrganization({ userId: user.id, session: row, orgSlug: `nope-${randomUUID()}` }).catch((e: Error) => e);
    expect(real).toBeInstanceOf(NotFoundError);
    expect(fake).toBeInstanceOf(NotFoundError);
    expect((real as Error).message.replace(victim.slug, "X")).toBe((fake as Error).message.replace(/nope-[0-9a-f-]+/, "X"));
    expect((await adminDb.session.findUniqueOrThrow({ where: { id: row.id } })).organizationId).toBe(a.id);
    expect(await adminDb.auditEvent.count({ where: { organizationId: victim.id, action: "auth.org_switched" } })).toBe(0);
  });

  it("refuses a deactivated, pending or removed membership and an inactive organisation", async () => {
    const { b, user, mb, row } = await twoOrgPerson();
    for (const status of ["INACTIVE", "PENDING", "REMOVED"] as const) {
      await adminDb.membership.update({ where: { id: mb.id }, data: { status } });
      await expect(switchOrganization({ userId: user.id, session: row, orgSlug: b.slug })).rejects.toBeInstanceOf(NotFoundError);
    }
    await adminDb.membership.update({ where: { id: mb.id }, data: { status: "ACTIVE" } });
    await adminDb.organization.update({ where: { id: b.id }, data: { status: "INACTIVE" } });
    await expect(switchOrganization({ userId: user.id, session: row, orgSlug: b.slug })).rejects.toBeInstanceOf(ValidationError);
    await adminDb.organization.update({ where: { id: b.id }, data: { status: "ACTIVE" } });
  });

  it("cannot move somebody else's session, nor a revoked one", async () => {
    const { b, user, row, created } = await twoOrgPerson();
    const intruder = await createTestUser("intruder");
    await join(intruder.id, b.id, "MANAGEMENT");
    // the intruder holds B membership but presents the victim's session row: the update is scoped to the session's own user
    await expect(switchOrganization({ userId: intruder.id, session: row, orgSlug: b.slug })).rejects.toBeInstanceOf(NotFoundError);
    expect((await adminDb.session.findUniqueOrThrow({ where: { id: row.id } })).organizationId).toBe(row.organizationId);
    await revokeSession(created.token, "SIGNED_OUT");
    await expect(switchOrganization({ userId: user.id, session: row, orgSlug: b.slug })).rejects.toBeInstanceOf(NotFoundError);
    expect((await lookupSession(created.token)).state).toBe("revoked");
  });

  it("needs a real session (the dev-session fallback has none)", async () => {
    const { b, user } = await twoOrgPerson();
    await expect(switchOrganization({ userId: user.id, session: null, orgSlug: b.slug })).rejects.toBeInstanceOf(ValidationError);
  });

  it("does not let a switched session read the other organisation's routes: the URL organisation is still checked", async () => {
    const a = await createTestOrganization("RouteA");
    const c = await createTestOrganization("RouteC");
    orgIds.push(a.id, c.id);
    const user = await createTestUser("route.user");
    await join(user.id, a.id, "MANAGEMENT");
    const s = await createSession(user.id, { client: { userAgent: "x" }, organizationId: a.id });
    const { resolveRequestContext } = await import("../src/auth/requestContext");
    const jar = { get: (n: string) => (n === SESSION_COOKIE_NAME ? { value: s.token } : undefined) };
    await expect(resolveRequestContext(c.slug, jar)).rejects.toThrow(/No active membership/);
    await expect(resolveRequestContext(a.slug, jar)).resolves.toMatchObject({ organizationId: a.id });
  });
});

describe("the routes", () => {
  it("list and switch work on the session cookie and refuse a signed-out caller", async () => {
    const { a, b, user, created } = await twoOrgPerson();
    const { GET } = await import("../src/app/api/me/organizations/route");
    const { POST } = await import("../src/app/api/me/organizations/switch/route");
    expect((await GET()).status).toBe(401);
    holder.jar = { get: (n) => (n === SESSION_COOKIE_NAME ? { value: created.token } : undefined) };
    const list = await (await GET()).json();
    expect(list.items.map((i: { slug: string }) => i.slug)).toEqual([a.slug, b.slug]);
    const res = await POST(new Request("http://localhost/api/me/organizations/switch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ organizationSlug: b.slug }) }));
    expect(res.status).toBe(200);
    expect((await res.json()).role.key).toBe("SALES");
    const bad = await POST(new Request("http://localhost/api/me/organizations/switch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) }));
    expect(bad.status).toBe(400);
    const missing = await POST(new Request("http://localhost/api/me/organizations/switch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ organizationSlug: "no-such-org" }) }));
    expect(missing.status).toBe(404);
    void user;
  });
});
