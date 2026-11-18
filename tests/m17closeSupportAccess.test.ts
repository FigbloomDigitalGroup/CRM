import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../src/auth/context";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { withOrgContext } from "../src/db/orgScopedClient";
import { getPlatformDb } from "../src/db/platformClient";
import { setOrganizationRelease } from "../src/services/featureService";
import { listAuditEvents } from "../src/services/platformAuditService";
import {
  decideSupportAccess,
  endSupportAccess,
  endSupportAccessByOrganisation,
  expireSupportAccess,
  getOrganisationSupportAccess,
  getSupportBanner,
  listOrganisationSupportAccess,
  openSupportAccess,
  readSupportAccess,
  requestSupportAccess,
  type SupportRequestInput,
} from "../src/services/supportAccessService";
import { createTestContext, createTestOrganization, getLeadStatusId, getPipelineStageId } from "./helpers/fixtures";
import { cookieJar, ctxParams, jsonRequest, makePlatformAdmin, removeTestPlatformAdmins, type TestPlatformAdmin } from "./helpers/platform";

/**
 * FIG-1183 (B7.01) close-out: independent proof of "no access without approval; expires automatically; everything logged".
 * Complements tests/supportAccess.test.ts (the builders' own); nothing here replaces it.
 */
const holder = vi.hoisted(() => ({ jar: { get: (_name: string): { value: string } | undefined => undefined }, ctx: null as unknown }));
vi.mock("next/headers", () => ({ cookies: async () => holder.jar }));
vi.mock("../src/auth/requestContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/auth/requestContext")>();
  return {
    ...actual,
    resolveRequestContext: async () => {
      if (!holder.ctx) {
        const { UnauthorizedError } = await import("../src/auth/errors");
        throw new UnauthorizedError();
      }
      return holder.ctx as AuthContext;
    },
  };
});

import * as orgGrantRoute from "../src/app/api/orgs/[orgSlug]/support-access/[grantId]/route";
import * as orgListRoute from "../src/app/api/orgs/[orgSlug]/support-access/route";

let admin: TestPlatformAdmin;
let other: TestPlatformAdmin;
const previousRelease = process.env.ACTIVE_RELEASE;

beforeAll(async () => {
  process.env.ACTIVE_RELEASE = "v2";
  admin = await makePlatformAdmin("m17c-admin");
  other = await makePlatformAdmin("m17c-other");
});
afterAll(async () => {
  if (previousRelease === undefined) delete process.env.ACTIVE_RELEASE;
  else process.env.ACTIVE_RELEASE = previousRelease;
  await removeTestPlatformAdmins();
  await getPlatformDb().$disconnect();
});
beforeEach(() => {
  holder.jar = admin.jar;
});
afterEach(() => {
  holder.jar = cookieJar({});
  holder.ctx = null;
});

const SECRET = "confidential 7654321 note";

async function world(label = "M17C") {
  const org = await createTestOrganization(label);
  await setOrganizationRelease(org.id, "v2");
  const tag = org.slug.slice(-6);
  const mgmt = await createTestContext(org.id, "MANAGEMENT", `m17c.mgmt.${tag}`);
  const sales = await createTestContext(org.id, "SALES", `m17c.sales.${tag}`);
  const finance = await createTestContext(org.id, "FINANCE", `m17c.fin.${tag}`);
  const company = await adminDb.company.create({ data: { organizationId: org.id, name: `Acme ${tag}`, email: "info@m17c-acme.example.com", phone: "+254700555123", notes: SECRET } });
  const contact = await adminDb.contact.create({ data: { organizationId: org.id, companyId: company.id, firstName: "Ann", lastName: "Doe", email: "ann.doe@m17c-acme.example.com", phone: "+254722333444", notes: SECRET } });
  const lead = await adminDb.lead.create({ data: { organizationId: org.id, companyId: company.id, contactId: contact.id, leadStatusId: await getLeadStatusId(org.id), notes: SECRET } });
  const deal = await adminDb.deal.create({
    data: { organizationId: org.id, companyId: company.id, ownerMembershipId: mgmt.membershipId, pipelineStageId: await getPipelineStageId(org.id), value: "1234567.89", notes: SECRET },
  });
  return { org, mgmt, sales, finance, company, contact, lead, deal };
}
type World = Awaited<ReturnType<typeof world>>;

function req(orgId: string, o: Partial<SupportRequestInput> = {}): SupportRequestInput {
  return { organizationId: orgId, reason: "Customer cannot open their pipeline view", ticketReference: "SUP-2001", scope: ["COMPANIES", "CONTACTS", "LEADS", "DEALS", "TASKS"], durationMinutes: 30, ...o };
}
async function backdate(grantId: string, set: string) {
  await adminDb.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
    await tx.$executeRawUnsafe(`UPDATE support_access_grants SET ${set} WHERE id = '${grantId}'`);
  });
}
const approved = async (w: World, o: Partial<SupportRequestInput> = {}, who = admin) => {
  const g = await requestSupportAccess(who.actor, req(w.org.id, o));
  await decideSupportAccess(w.mgmt, g.id, "approve", "ok");
  return g;
};
const active = async (w: World, o: Partial<SupportRequestInput> = {}, who = admin) => openSupportAccess(who.actor, (await approved(w, o, who)).id);
const viewCount = (grantId: string) => adminDb.supportAccessPageView.count({ where: { grantId } });
const RESOURCES = ["COMPANIES", "CONTACTS", "LEADS", "DEALS", "TASKS"];

describe("no read of tenant data without an approved, unexpired, opened grant: every state", () => {
  it("is refused in every state except ACTIVE, writes no page view, and writes a refusal to the platform audit", async () => {
    const w = await world();
    const states: Record<string, string> = {};

    // requested
    states.PENDING = (await requestSupportAccess(admin.actor, req(w.org.id))).id;
    // denied (new org because one open request per organisation)
    const w2 = await world("Denied");
    const g2 = await requestSupportAccess(admin.actor, req(w2.org.id));
    await decideSupportAccess(w2.mgmt, g2.id, "deny", "no");
    states.DENIED = g2.id;
    // request lapsed (24h)
    const w3 = await world("Lapsed");
    const g3 = await requestSupportAccess(admin.actor, req(w3.org.id));
    await backdate(g3.id, `request_expires_at = now() - interval '1 second'`);
    states.REQUEST_LAPSED = g3.id;
    // withdrawn
    const w4 = await world("Withdrawn");
    const g4 = await requestSupportAccess(admin.actor, req(w4.org.id));
    await endSupportAccess(admin.actor, g4.id);
    states.CANCELLED = g4.id;
    // approved, not yet opened
    const w5 = await world("ApprovedNotOpen");
    states.APPROVED_NOT_OPEN = (await approved(w5)).id;
    // approved, unopened for more than an hour
    const w6 = await world("ApprovedStale");
    const g6 = await approved(w6);
    await backdate(g6.id, `decided_at = now() - interval '61 minutes'`);
    states.APPROVED_STALE = g6.id;
    // ended
    const w7 = await world("Ended");
    const g7 = await active(w7);
    await endSupportAccess(admin.actor, g7.id);
    states.ENDED = g7.id;
    // window over, no job has run
    const w8 = await world("WindowOver");
    const g8 = await active(w8);
    await backdate(g8.id, `starts_at = now() - interval '31 minutes', ends_at = now() - interval '1 second'`);
    states.WINDOW_OVER = g8.id;

    for (const [state, id] of Object.entries(states)) {
      for (const resource of RESOURCES) {
        await expect(readSupportAccess(admin.actor, id, resource), `${state} ${resource}`).rejects.toMatchObject({ status: 403 });
      }
      expect(await viewCount(id), state).toBe(0);
      // The same through the database function with the platform role: the wall is in the database, not only in the service.
      await expect(getPlatformDb().$queryRaw`SELECT support_access_read(${id}, ${admin.id}, 'x', 'COMPANIES', 10, 0)`, state).rejects.toThrow(/NOT_ACTIVE/);
      const refused = (await listAuditEvents({ action: "support_access.read_refused", limit: 200 })).items.filter((e) => e.targetId === id);
      expect(refused.length, state).toBe(RESOURCES.length);
    }

    // The contrast: the one state that reads.
    const live = await active(await world("Live"));
    await expect(readSupportAccess(admin.actor, live.id, "COMPANIES")).resolves.toMatchObject({ total: 1 });
  });

  it("a state cannot be forged: the platform role cannot write the table, and a tenant role cannot open or skip approval", async () => {
    const w = await world();
    const g = await requestSupportAccess(admin.actor, req(w.org.id));
    const platform = getPlatformDb();
    await expect(platform.$executeRaw`UPDATE support_access_grants SET status = 'ACTIVE' WHERE id = ${g.id}`).rejects.toThrow(/permission denied/);
    await expect(platform.$executeRaw`DELETE FROM support_access_grants WHERE id = ${g.id}`).rejects.toThrow(/permission denied/);

    // The tenant role (the application connection) may decide, but PENDING to ACTIVE and APPROVED to ACTIVE are the platform's alone, and nobody skips approval.
    const open = (id: string) =>
      withOrgContext(w.org.id, (tx) =>
        tx.$executeRawUnsafe(`UPDATE support_access_grants SET status = 'ACTIVE', opened_at = now(), starts_at = now(), ends_at = now() + interval '30 minutes', opened_by_identity_id = '${admin.id}' WHERE id = '${id}'`),
      );
    await expect(open(g.id)).rejects.toThrow(/cannot move from PENDING to ACTIVE/);
    await decideSupportAccess(w.mgmt, g.id, "approve", undefined);
    await expect(open(g.id)).rejects.toThrow(/cannot move from APPROVED to ACTIVE/);
    await expect(readSupportAccess(admin.actor, g.id, "COMPANIES")).rejects.toMatchObject({ status: 403 });
    // The tenant role cannot extend or rewrite the window or what was asked for.
    await expect(withOrgContext(w.org.id, (tx) => tx.$executeRawUnsafe(`UPDATE support_access_grants SET scope = ARRAY['COMPANIES']::text[] WHERE id = '${g.id}'`))).rejects.toThrow(/cannot be changed/);
    await expect(withOrgContext(w.org.id, (tx) => tx.$executeRawUnsafe(`DELETE FROM support_access_grants WHERE id = '${g.id}'`))).rejects.toThrow();
  });

  it("a request that is approved cannot be turned into a session by a different platform admin", async () => {
    const w = await world();
    const g = await approved(w); // requested by `admin`
    await expect(openSupportAccess(other.actor, g.id)).rejects.toMatchObject({ message: expect.stringContaining("Only the admin who asked") });
    await expect(getPlatformDb().$queryRaw`SELECT * FROM support_access_open(${g.id}, ${other.id}, now()::timestamp)`).resolves.toHaveLength(0);
    await expect(readSupportAccess(admin.actor, g.id, "COMPANIES")).rejects.toMatchObject({ status: 403 });
  });
});

describe("expiry happens without any action", () => {
  it("the clock refuses reads, the banner and the history show it expired, and nothing needs the job", async () => {
    const w = await world();
    const g = await active(w);
    // One minute before the end: still open. (Time travel: move the window rather than wait.)
    await backdate(g.id, `starts_at = now() - interval '29 minutes', ends_at = now() + interval '1 minute'`);
    await expect(readSupportAccess(admin.actor, g.id, "COMPANIES")).resolves.toMatchObject({ total: 1 });
    expect((await getSupportBanner(w.sales)).active).not.toBeNull();
    const before = await viewCount(g.id);

    // One second past the end. No job, no request, no click.
    await backdate(g.id, `starts_at = now() - interval '31 minutes', ends_at = now() - interval '1 second'`);
    expect((await adminDb.supportAccessGrant.findUniqueOrThrow({ where: { id: g.id } })).status).toBe("ACTIVE"); // the row has not been touched
    for (const r of RESOURCES) await expect(readSupportAccess(admin.actor, g.id, r)).rejects.toMatchObject({ status: 403 });
    expect(await viewCount(g.id)).toBe(before);
    expect((await getSupportBanner(w.sales)).active).toBeNull();
    expect((await getSupportBanner(w.mgmt)).active).toBeNull();
    expect((await listOrganisationSupportAccess(w.mgmt)).items.find((i) => i.id === g.id)).toMatchObject({ status: "EXPIRED", secondsLeft: null });
    // Management cannot "end" something that already ran out, and the platform cannot revive or end it.
    await expect(endSupportAccessByOrganisation(w.mgmt, g.id)).rejects.toBeInstanceOf(ValidationError);
    await expect(openSupportAccess(admin.actor, g.id)).rejects.toBeInstanceOf(ValidationError);
    expect(await endSupportAccess(admin.actor, g.id)).toMatchObject({ status: "EXPIRED" });
    // The job only tidies: it marks it and writes the expiry to both audit logs, once.
    expect(await expireSupportAccess(w.org.id)).toEqual({ expired: 1 });
    expect((await adminDb.supportAccessGrant.findUniqueOrThrow({ where: { id: g.id } })).status).toBe("EXPIRED");
    expect(await adminDb.auditEvent.count({ where: { organizationId: w.org.id, action: "support_access.expired", entityId: g.id } })).toBe(1);
    expect((await listAuditEvents({ organizationId: w.org.id, action: "support_access.expired" })).items).toHaveLength(1);
  });

  it("an approval left unopened for an hour and a request left for 24 hours both lapse by the clock alone", async () => {
    const w = await world();
    const g = await approved(w);
    await backdate(g.id, `decided_at = now() - interval '61 minutes'`);
    await expect(openSupportAccess(admin.actor, g.id)).rejects.toMatchObject({ message: expect.stringContaining("expired") });
    await expect(getPlatformDb().$queryRaw`SELECT * FROM support_access_open(${g.id}, ${admin.id}, now()::timestamp)`).rejects.toThrow(/older than one hour/);
    expect((await getSupportBanner(w.mgmt)).pending).toBeNull();
    // The organisation is not stuck behind a lapsed grant only once the job runs; until then the open-request rule still blocks (documented, see the report).
    expect(await expireSupportAccess(w.org.id)).toEqual({ expired: 1 });
    await expect(requestSupportAccess(admin.actor, req(w.org.id))).resolves.toMatchObject({ status: "PENDING" });
  });
});

describe("ending early is immediate and logged", () => {
  it("platform end and organisation end each refuse the very next read, log twice, and tell Management or the platform", async () => {
    for (const by of ["platform", "organisation"] as const) {
      const w = await world(`End ${by}`);
      const g = await active(w);
      await readSupportAccess(admin.actor, g.id, "COMPANIES");
      const after = by === "platform" ? await endSupportAccess(admin.actor, g.id) : await endSupportAccessByOrganisation(w.mgmt, g.id);
      expect(after.status).toBe("ENDED");
      const viewsAtEnd = await viewCount(g.id);
      await expect(readSupportAccess(admin.actor, g.id, "COMPANIES")).rejects.toMatchObject({ status: 403 });
      expect(await viewCount(g.id)).toBe(viewsAtEnd);
      expect((await getSupportBanner(w.sales)).active).toBeNull();
      expect(await adminDb.auditEvent.count({ where: { organizationId: w.org.id, action: "support_access.ended", entityId: g.id } })).toBe(1);
      expect((await listAuditEvents({ organizationId: w.org.id, action: "support_access.ended" })).items).toHaveLength(1);
      // Ending twice is harmless and writes nothing more.
      if (by === "platform") await endSupportAccess(admin.actor, g.id);
      expect(await adminDb.auditEvent.count({ where: { organizationId: w.org.id, action: "support_access.ended", entityId: g.id } })).toBe(1);
    }
  });

  it("withdrawing an approval (organisation) closes it before it is ever opened", async () => {
    const w = await world();
    const g = await approved(w);
    expect(await endSupportAccessByOrganisation(w.mgmt, g.id)).toMatchObject({ status: "ENDED" });
    await expect(openSupportAccess(admin.actor, g.id)).rejects.toBeInstanceOf(ValidationError);
    await expect(readSupportAccess(admin.actor, g.id, "COMPANIES")).rejects.toMatchObject({ status: 403 });
  });
});

describe("the platform role cannot read the grant tables or tenant rows directly", () => {
  it("has no SELECT, INSERT, UPDATE or DELETE on grants, page views, tenant records, memberships or audit", async () => {
    const w = await world();
    const g = await active(w);
    const platform = getPlatformDb();
    for (const table of ["support_access_grants", "support_access_page_views", "companies", "contacts", "leads", "deals", "tasks", "invoices", "payment_records", "memberships", "users", "audit_events", "notes"]) {
      await expect(platform.$queryRawUnsafe(`SELECT * FROM ${table} LIMIT 1`), `SELECT ${table}`).rejects.toThrow(/permission denied|does not exist/);
    }
    await expect(platform.$executeRawUnsafe(`DELETE FROM support_access_page_views WHERE grant_id = '${g.id}'`)).rejects.toThrow(/permission denied/);
    await expect(platform.$executeRawUnsafe(`UPDATE support_access_page_views SET row_count = 0 WHERE grant_id = '${g.id}'`)).rejects.toThrow(/permission denied/);
    await expect(platform.$executeRawUnsafe(`INSERT INTO support_access_page_views (organization_id, grant_id, identity_label, resource) VALUES ('${w.org.id}', '${g.id}', 'forged', 'COMPANIES')`)).rejects.toThrow(/permission denied/);
    // The functions exist as the only door.
    await expect(platform.$queryRaw`SELECT count(*)::int AS n FROM support_access_get(${g.id})`).resolves.toEqual([{ n: 1 }]);
  });
});

describe("masking of sensitive values", () => {
  it("never returns money, notes or custom fields for any resource, with or without unmasking", async () => {
    const w = await world();
    for (const unmask of [false, true]) {
      const org = unmask ? await world("Unmasked") : w;
      const g = await active(org, { unmaskContactDetails: unmask });
      const dump = JSON.stringify(await Promise.all(RESOURCES.map((r) => readSupportAccess(admin.actor, g.id, r))));
      for (const secret of ["1234567", "89", SECRET, "confidential", "notes", "value", "currency", "amount", "margin", "cost", "payment", "customFields"]) {
        if (secret === "89") continue; // too short to be a meaningful needle on its own
        expect(dump.toLowerCase(), `unmask=${unmask} ${secret}`).not.toContain(secret.toLowerCase());
      }
      if (!unmask) for (const pii of ["info@m17c", "ann.doe@m17c", "700555123", "722333444"]) expect(dump).not.toContain(pii);
      else expect(dump).toContain("ann.doe@m17c-acme.example.com");
    }
  });

  it("masks odd emails and phones the same way (no at-sign, short phone) and keeps do-not-contact visible", async () => {
    const w = await world();
    await adminDb.contact.create({ data: { organizationId: w.org.id, firstName: "No", lastName: "At", email: "not-an-email", phone: "12", doNotContact: true } });
    const g = await active(w);
    const out = await readSupportAccess(admin.actor, g.id, "CONTACTS");
    const odd = out.items.find((i) => i.firstName === "No")!;
    expect(odd).toMatchObject({ email: "***", phone: "***", doNotContact: true });
  });

  it("the grant's organisation owns the read: an admin's grant on B cannot read A, and A's grant cannot be read as B's", async () => {
    const a = await world("Own A");
    const b = await world("Own B");
    const gA = await active(a, {}, admin);
    const gB = await active(b, {}, other);
    // `other` holds a live session on B only: using it names B's records; using A's grant id is refused.
    const asOtherOnB = JSON.stringify(await Promise.all(RESOURCES.map((r) => readSupportAccess(other.actor, gB.id, r))));
    expect(asOtherOnB).toContain(b.company.id);
    expect(asOtherOnB).not.toContain(a.company.id);
    for (const r of RESOURCES) await expect(readSupportAccess(other.actor, gA.id, r)).rejects.toMatchObject({ status: 403 });
    for (const r of RESOURCES) await expect(readSupportAccess(admin.actor, gB.id, r)).rejects.toMatchObject({ status: 403 });
    await expect(getPlatformDb().$queryRaw`SELECT support_access_read(${gA.id}, ${other.id}, 'x', 'COMPANIES', 10, 0)`).rejects.toThrow(/NOT_ACTIVE/);
  });
});

describe("the page-view log is visible to the organisation's Management and nobody else", () => {
  it("Management of the organisation reads it; other roles, other organisations and the tenant tables' RLS do not", async () => {
    const a = await world("Log A");
    const b = await world("Log B");
    const g = await active(a);
    await readSupportAccess(admin.actor, g.id, "COMPANIES");
    await readSupportAccess(admin.actor, g.id, "TASKS", { limit: 5, offset: 0 });

    const mine = await getOrganisationSupportAccess(a.mgmt, g.id);
    expect(mine.pageViews).toHaveLength(2);
    expect(mine.pageViews.map((v) => v.resource).sort()).toEqual(["COMPANIES", "TASKS"]);
    expect(mine.pageViews.every((v) => v.by === admin.email && typeof v.viewedAt === "string")).toBe(true);

    for (const ctx of [a.sales, a.finance]) {
      await expect(getOrganisationSupportAccess(ctx, g.id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(listOrganisationSupportAccess(ctx)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(decideSupportAccess(ctx, g.id, "deny", undefined)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(endSupportAccessByOrganisation(ctx, g.id)).rejects.toBeInstanceOf(ForbiddenError);
    }
    // Other roles see the banner (that a session runs) but not the log, reason or ticket.
    const banner = JSON.stringify(await getSupportBanner(a.sales));
    expect(banner).not.toContain("SUP-2001");
    expect(banner).not.toContain("pipeline");

    // Another organisation, even its Management: not found; and row-level security hides the rows from its own queries.
    await expect(getOrganisationSupportAccess(b.mgmt, g.id)).rejects.toBeInstanceOf(NotFoundError);
    const rows = await withOrgContext(b.org.id, (tx) => tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM support_access_page_views WHERE grant_id = $1`, g.id));
    expect(Number(rows[0]!.n)).toBe(0);
    expect(JSON.stringify(await getSupportBanner(b.mgmt))).not.toContain(g.id);
    await expect(withOrgContext(b.org.id, (tx) => tx.$executeRawUnsafe(`UPDATE support_access_grants SET decision_note = 'x' WHERE id = '${g.id}'`))).resolves.toBe(0);
    await expect(withOrgContext(a.org.id, (tx) => tx.$executeRawUnsafe(`UPDATE support_access_page_views SET row_count = 0 WHERE grant_id = '${g.id}'`))).rejects.toThrow();
    await expect(withOrgContext(a.org.id, (tx) => tx.$executeRawUnsafe(`INSERT INTO support_access_page_views (organization_id, grant_id, identity_label, resource) VALUES ('${a.org.id}', '${g.id}', 'forged', 'DEALS')`))).rejects.toThrow();
  });

  it("through the organisation routes: Management gets 200 with the log, Sales 403, another organisation's Management 404", async () => {
    const a = await world("Route A");
    const b = await world("Route B");
    const g = await active(a);
    await readSupportAccess(admin.actor, g.id, "LEADS");
    holder.ctx = a.mgmt;
    const ok = await orgGrantRoute.GET(jsonRequest("/x", "GET"), ctxParams({ orgSlug: a.org.slug, grantId: g.id }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).pageViews).toHaveLength(1);
    expect((await orgListRoute.GET(jsonRequest("/x", "GET"), ctxParams({ orgSlug: a.org.slug }))).status).toBe(200);
    holder.ctx = a.sales;
    expect((await orgGrantRoute.GET(jsonRequest("/x", "GET"), ctxParams({ orgSlug: a.org.slug, grantId: g.id }))).status).toBe(403);
    expect((await orgListRoute.GET(jsonRequest("/x", "GET"), ctxParams({ orgSlug: a.org.slug }))).status).toBe(403);
    holder.ctx = b.mgmt;
    expect((await orgGrantRoute.GET(jsonRequest("/x", "GET"), ctxParams({ orgSlug: b.org.slug, grantId: g.id }))).status).toBe(404);
  });
});

describe("everything is logged: one audit row per state change and per page view", () => {
  it("writes the lifecycle to the organisation's audit and to the platform audit, and one page-view row plus one audit row per read", async () => {
    const w = await world();
    const g = await requestSupportAccess(admin.actor, req(w.org.id));
    await decideSupportAccess(w.mgmt, g.id, "approve", undefined);
    await openSupportAccess(admin.actor, g.id);
    const reads: [string, number][] = [["COMPANIES", 0], ["CONTACTS", 0], ["DEALS", 0], ["COMPANIES", 0]];
    for (const [r, off] of reads) await readSupportAccess(admin.actor, g.id, r, { limit: 10, offset: off });
    await endSupportAccess(admin.actor, g.id);

    expect(await viewCount(g.id)).toBe(reads.length);
    const platformActions = (await listAuditEvents({ organizationId: w.org.id, limit: 200 })).items.filter((e) => e.targetId === g.id).map((e) => e.action);
    expect(platformActions.filter((a) => a === "support_access.viewed")).toHaveLength(reads.length);
    for (const a of ["support_access.requested", "support_access.approved", "support_access.opened", "support_access.ended"]) {
      expect(platformActions.filter((x) => x === a), a).toHaveLength(1);
    }
    const tenantActions = (await adminDb.auditEvent.findMany({ where: { organizationId: w.org.id, entityType: "SupportAccessGrant", entityId: g.id } })).map((e) => e.action).sort();
    expect(tenantActions).toEqual(["support_access.approved", "support_access.ended", "support_access.requested", "support_access.started"]);

    // Deny and withdraw are logged too.
    const w2 = await world("DenyLog");
    const g2 = await requestSupportAccess(admin.actor, req(w2.org.id));
    await decideSupportAccess(w2.mgmt, g2.id, "deny", "no");
    expect((await adminDb.auditEvent.findMany({ where: { organizationId: w2.org.id, entityId: g2.id } })).map((e) => e.action).sort()).toEqual(["support_access.denied", "support_access.requested"]);
    const w3 = await world("WithdrawLog");
    const g3 = await requestSupportAccess(admin.actor, req(w3.org.id));
    await endSupportAccess(admin.actor, g3.id);
    expect((await adminDb.auditEvent.findMany({ where: { organizationId: w3.org.id, entityId: g3.id } })).map((e) => e.action).sort()).toEqual(["support_access.cancelled", "support_access.requested"]);
  });

  it("the audit entries carry the reason and ticket (platform side) and never customer data or notes", async () => {
    const w = await world();
    const g = await active(w);
    await readSupportAccess(admin.actor, g.id, "DEALS");
    const platformRows = (await listAuditEvents({ organizationId: w.org.id, limit: 200 })).items.filter((e) => e.targetId === g.id);
    expect(platformRows.length).toBeGreaterThanOrEqual(4);
    expect(platformRows.filter((e) => e.actorLabel === admin.email).every((e) => e.reason === "Customer cannot open their pipeline view" && JSON.stringify(e.metadata).includes("SUP-2001"))).toBe(true);
    const all = JSON.stringify([platformRows, await adminDb.auditEvent.findMany({ where: { organizationId: w.org.id, entityId: g.id } })]);
    for (const secret of ["1234567", SECRET, "ann.doe", "info@m17c", "+2547"]) expect(all).not.toContain(secret);
  });
});

describe("cross-organisation attempts fail (rule 8)", () => {
  it("another organisation's Management cannot decide, end or list this grant, and the request itself cannot name a missing organisation", async () => {
    const a = await world("X A");
    const b = await world("X B");
    const g = await requestSupportAccess(admin.actor, req(a.org.id));
    await expect(decideSupportAccess(b.mgmt, g.id, "approve", undefined)).rejects.toBeInstanceOf(NotFoundError);
    expect((await adminDb.supportAccessGrant.findUniqueOrThrow({ where: { id: g.id } })).status).toBe("PENDING");
    await decideSupportAccess(a.mgmt, g.id, "approve", undefined);
    await openSupportAccess(admin.actor, g.id);
    await expect(endSupportAccessByOrganisation(b.mgmt, g.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listOrganisationSupportAccess(b.mgmt)).items).toHaveLength(0);
    expect((await getSupportBanner(b.mgmt)).active).toBeNull();
    await expect(readSupportAccess(admin.actor, g.id, "COMPANIES")).resolves.toMatchObject({ total: 1 });
    await expect(requestSupportAccess(admin.actor, req("no-such-organisation"))).rejects.toBeInstanceOf(NotFoundError);
  });
});
