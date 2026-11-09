import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../src/auth/context";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { getUnscopedAppClientForTests, withOrgContext } from "../src/db/orgScopedClient";
import { getPlatformDb } from "../src/db/platformClient";
import { setOrganizationRelease } from "../src/services/featureService";
import { transitionOrganization } from "../src/services/organizationLifecycleService";
import { listAuditEvents } from "../src/services/platformAuditService";
import {
  decideSupportAccess,
  effectiveStatus,
  endSupportAccess,
  endSupportAccessByOrganisation,
  expireSupportAccess,
  getOrganisationSupportAccess,
  getSupportAccess,
  getSupportBanner,
  listOrganisationSupportAccess,
  openSupportAccess,
  readSupportAccess,
  requestSupportAccess,
  type SupportRequestInput,
} from "../src/services/supportAccessService";
import { createTestContext, getLeadStatusId, getPipelineStageId, createTestOrganization } from "./helpers/fixtures";
import { cookieJar, ctxParams, jsonRequest, makePlatformAdmin, removeTestPlatformAdmins, type TestPlatformAdmin } from "./helpers/platform";

/**
 * FIG-1183 (B7.01): support access. One test or more for each of R1 to R12 in docs/SECURITY_REVIEW_PLATFORM_CONSOLE.md section 5.
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

import * as requestRoute from "../src/app/api/platform/support-access/route";
import * as openRoute from "../src/app/api/platform/support-access/[grantId]/open/route";
import * as readRoute from "../src/app/api/platform/support-access/[grantId]/read/route";
import * as decisionRoute from "../src/app/api/orgs/[orgSlug]/support-access/[grantId]/decision/route";
import * as bannerRoute from "../src/app/api/orgs/[orgSlug]/support-access/banner/route";

const HOUR = 3_600_000;
let admin: TestPlatformAdmin;
let other: TestPlatformAdmin;
const previousRelease = process.env.ACTIVE_RELEASE;

beforeAll(async () => {
  process.env.ACTIVE_RELEASE = "v2";
  admin = await makePlatformAdmin("support-admin");
  other = await makePlatformAdmin("support-other");
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

const SECRET_NOTE = "private price talk 987654 shillings";

async function world(label = "Support") {
  const org = await createTestOrganization(label);
  await setOrganizationRelease(org.id, "v2");
  const tag = org.slug.slice(-6);
  const mgmt = await createTestContext(org.id, "MANAGEMENT", `sa.mgmt.${tag}`);
  const sales = await createTestContext(org.id, "SALES", `sa.sales.${tag}`);
  const company = await adminDb.company.create({ data: { organizationId: org.id, name: `Acme ${tag} Ltd`, email: "info@acme-sa.example.com", phone: "+254700123456", notes: SECRET_NOTE } });
  const contact = await adminDb.contact.create({ data: { organizationId: org.id, companyId: company.id, firstName: "Jane", lastName: "Doe", email: "jane.doe@acme-sa.example.com", phone: "+254711987654", notes: SECRET_NOTE } });
  const lead = await adminDb.lead.create({ data: { organizationId: org.id, companyId: company.id, contactId: contact.id, leadStatusId: await getLeadStatusId(org.id), notes: SECRET_NOTE } });
  const deal = await adminDb.deal.create({
    data: { organizationId: org.id, companyId: company.id, ownerMembershipId: mgmt.membershipId, pipelineStageId: await getPipelineStageId(org.id), value: "987654.32", notes: SECRET_NOTE },
  });
  const task = await adminDb.task.create({ data: { organizationId: org.id, title: "Call Jane", assigneeMembershipId: mgmt.membershipId, createdByMembershipId: mgmt.membershipId, dealId: deal.id } });
  return { org, mgmt, sales, company, contact, lead, deal, task };
}

function req(orgId: string, overrides: Partial<SupportRequestInput> = {}): SupportRequestInput {
  return {
    organizationId: orgId,
    reason: "Customer cannot see their pipeline since Monday",
    ticketReference: "SUP-1042",
    scope: ["COMPANIES", "CONTACTS", "LEADS", "DEALS", "TASKS"],
    durationMinutes: 30,
    ...overrides,
  };
}

/** Rows the clock should have overtaken: the guard trigger makes the window write-once, so tests step around it as the owner. */
async function backdate(grantId: string, set: string) {
  await adminDb.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
    await tx.$executeRawUnsafe(`UPDATE support_access_grants SET ${set} WHERE id = '${grantId}'`);
  });
}

async function approved(w: Awaited<ReturnType<typeof world>>, overrides: Partial<SupportRequestInput> = {}) {
  const g = await requestSupportAccess(admin.actor, req(w.org.id, overrides));
  await decideSupportAccess(w.mgmt, g.id, "approve", "Go ahead");
  return g;
}

async function active(w: Awaited<ReturnType<typeof world>>, overrides: Partial<SupportRequestInput> = {}) {
  const g = await approved(w, overrides);
  return openSupportAccess(admin.actor, g.id);
}

describe("R1 and R2: a separate grant that the organisation must approve", () => {
  it("a request is its own record, waits for Management, tells every Management member, and reads nothing while it waits", async () => {
    const w = await world();
    const g = await requestSupportAccess(admin.actor, req(w.org.id));
    expect(g).toMatchObject({ status: "PENDING", requestedBy: admin.email, ticketReference: "SUP-1042", durationMinutes: 30, unmaskContactDetails: false });

    await expect(readSupportAccess(admin.actor, g.id, "COMPANIES")).rejects.toMatchObject({ status: 403 });
    await expect(openSupportAccess(admin.actor, g.id)).rejects.toMatchObject({ message: expect.stringContaining("has not approved") });
    const told = await adminDb.notification.findMany({ where: { organizationId: w.org.id, type: "SUPPORT_ACCESS_REQUEST" } });
    expect(told.map((n) => n.membershipId)).toEqual([w.mgmt.membershipId]);
    expect(told[0]!.body).toContain("SUP-1042");
    expect((await adminDb.auditEvent.findMany({ where: { organizationId: w.org.id, action: "support_access.requested" } })).length).toBe(1);
  });

  it("only Management decides; approving opens nothing; denying ends it", async () => {
    const w = await world();
    const g = await requestSupportAccess(admin.actor, req(w.org.id));
    await expect(decideSupportAccess(w.sales, g.id, "approve", undefined)).rejects.toBeInstanceOf(ForbiddenError);
    const decided = await decideSupportAccess(w.mgmt, g.id, "approve", "ok");
    expect(decided).toMatchObject({ status: "APPROVED", decisionNote: "ok" });
    expect(decided.decidedBy).toContain("(Management)");
    // Approved, not opened: still nothing is readable.
    await expect(readSupportAccess(admin.actor, g.id, "COMPANIES")).rejects.toMatchObject({ status: 403 });
    await expect(decideSupportAccess(w.mgmt, g.id, "approve", undefined)).rejects.toMatchObject({ name: "ValidationError" });

    const w2 = await world("Denied");
    const g2 = await requestSupportAccess(admin.actor, req(w2.org.id));
    expect(await decideSupportAccess(w2.mgmt, g2.id, "deny", "not now")).toMatchObject({ status: "DENIED" });
    await expect(openSupportAccess(admin.actor, g2.id)).rejects.toBeInstanceOf(ValidationError);
  });

  it("one open request per organisation, and a request needs a reason, a ticket, a scope and 30, 60 or 120 minutes", async () => {
    const w = await world();
    await requestSupportAccess(admin.actor, req(w.org.id));
    await expect(requestSupportAccess(admin.actor, req(w.org.id))).rejects.toMatchObject({ message: expect.stringContaining("already has an open support request") });
    const w2 = await world("Valid");
    for (const bad of [{ reason: "short" }, { ticketReference: "x" }, { scope: [] }, { scope: ["PAYMENTS"] }, { durationMinutes: 45 }, { durationMinutes: 240 }]) {
      await expect(requestSupportAccess(admin.actor, req(w2.org.id, bad as Partial<SupportRequestInput>))).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it("is refused for an organisation that is not active or not on release V2", async () => {
    const w = await world("Not active");
    await transitionOrganization(admin.actor, w.org.id, "suspend", "Unpaid invoices for a long time");
    await expect(requestSupportAccess(admin.actor, req(w.org.id))).rejects.toMatchObject({ message: expect.stringContaining("active organisation") });
    const v11 = await world("Release");
    await setOrganizationRelease(v11.org.id, "v1.1");
    await expect(requestSupportAccess(admin.actor, req(v11.org.id))).rejects.toMatchObject({ message: expect.stringContaining("release") });
  });

  /** The platform acting inside a `support_access_*` function is the owner connection with this marker; the trigger applies the platform's rules to it. */
  const asPlatformFunction = (sql: string) =>
    adminDb.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.support_actor', 'platform', true)`);
      await tx.$executeRawUnsafe(sql);
    });

  it("the database itself refuses the platform side that tries to approve or skip approval, and a tenant role that tries to create a request", async () => {
    const w = await world();
    const g = await requestSupportAccess(admin.actor, req(w.org.id));
    const platform = getPlatformDb();
    // The platform role itself cannot touch the table at all: it has the functions and nothing else.
    await expect(platform.$executeRaw`UPDATE support_access_grants SET status = 'APPROVED' WHERE id = ${g.id}`).rejects.toThrow(/permission denied/);
    await expect(platform.$queryRaw`SELECT * FROM support_access_grants WHERE id = ${g.id}`).rejects.toThrow(/permission denied/);
    await expect(platform.$queryRaw`SELECT * FROM support_access_page_views LIMIT 1`).rejects.toThrow(/permission denied/);
    // And whatever acts as the platform (inside a function) is held to the platform's moves by the trigger.
    await expect(asPlatformFunction(`UPDATE support_access_grants SET status = 'APPROVED', decided_at = now(), decided_by_membership_id = '${w.mgmt.membershipId}' WHERE id = '${g.id}'`)).rejects.toThrow(/cannot move from PENDING to APPROVED/);
    await expect(asPlatformFunction(`UPDATE support_access_grants SET status = 'ACTIVE', opened_at = now(), starts_at = now(), ends_at = now() + interval '30 minutes', opened_by_identity_id = '${admin.id}' WHERE id = '${g.id}'`)).rejects.toThrow(/cannot move from PENDING to ACTIVE/);
    await expect(asPlatformFunction(`UPDATE support_access_grants SET duration_minutes = 120 WHERE id = '${g.id}'`)).rejects.toThrow(/cannot be changed/);
    await expect(
      withOrgContext(w.org.id, (tx) =>
        tx.$executeRaw`INSERT INTO support_access_grants (id, organization_id, requested_by_identity_id, requested_by_label, reason, ticket_reference, scope, duration_minutes, request_expires_at)
                       VALUES (gen_random_uuid()::text, ${w.org.id}, 'x', 'x', 'a reason that is long enough', 'SUP-1', ARRAY['COMPANIES'], 30, now() + interval '1 day')`,
      ),
    ).rejects.toThrow(/permission denied|Only the platform/);
    // Approved by Management, the platform may open it but nobody can rewrite the decision.
    await decideSupportAccess(w.mgmt, g.id, "approve", undefined);
    await expect(asPlatformFunction(`UPDATE support_access_grants SET decided_at = now() - interval '2 hours' WHERE id = '${g.id}'`)).rejects.toThrow(/cannot be rewritten/);
    await expect(asPlatformFunction(`UPDATE support_access_grants SET status = 'ACTIVE', opened_at = now(), starts_at = now(), ends_at = now() + interval '600 minutes', opened_by_identity_id = '${admin.id}' WHERE id = '${g.id}'`)).rejects.toThrow(/last exactly the approved time/);
  });
});

describe("R3: a window of the approved length, checked on every read", () => {
  it("opens for exactly the approved minutes, only for the admin who asked, and a late open is refused", async () => {
    const w = await world();
    const g = await approved(w, { durationMinutes: 60 });
    await expect(openSupportAccess(other.actor, g.id)).rejects.toMatchObject({ message: expect.stringContaining("Only the admin who asked") });
    const opened = await openSupportAccess(admin.actor, g.id);
    expect(opened.status).toBe("ACTIVE");
    expect(new Date(opened.endsAt!).getTime() - new Date(opened.startsAt!).getTime()).toBe(60 * 60_000);
    expect(opened.secondsLeft).toBeGreaterThan(3500);
    await expect(openSupportAccess(admin.actor, g.id)).rejects.toMatchObject({ message: expect.stringContaining("already open") });

    // The other admin cannot read someone else's session either.
    await expect(readSupportAccess(other.actor, g.id, "COMPANIES")).rejects.toMatchObject({ status: 403 });

    const stale = await approved(await world("Stale"));
    await backdate(stale.id, `decided_at = now() - interval '2 hours'`);
    await expect(openSupportAccess(admin.actor, stale.id)).rejects.toMatchObject({ message: expect.stringContaining("expired") });
  });

  it("refuses reads the moment the window ends, even before any job has marked it, then the job marks it and tells Management", async () => {
    const w = await world();
    const g = await active(w);
    await expect(readSupportAccess(admin.actor, g.id, "COMPANIES")).resolves.toMatchObject({ total: 1 });
    await backdate(g.id, `starts_at = now() - interval '40 minutes', ends_at = now() - interval '10 minutes'`);
    expect(effectiveStatus(await adminDb.supportAccessGrant.findUniqueOrThrow({ where: { id: g.id } }))).toBe("EXPIRED");
    await expect(readSupportAccess(admin.actor, g.id, "COMPANIES")).rejects.toMatchObject({ status: 403, message: expect.stringContaining("not open") });
    expect((await getSupportAccess(g.id)).status).toBe("EXPIRED");

    const before = await adminDb.notification.count({ where: { organizationId: w.org.id, type: "SUPPORT_ACCESS_REQUEST" } });
    expect(await expireSupportAccess(w.org.id)).toEqual({ expired: 1 });
    expect(await expireSupportAccess(w.org.id)).toEqual({ expired: 0 });
    expect((await adminDb.supportAccessGrant.findUniqueOrThrow({ where: { id: g.id } })).status).toBe("EXPIRED");
    expect(await adminDb.notification.count({ where: { organizationId: w.org.id, type: "SUPPORT_ACCESS_REQUEST" } })).toBe(before + 1);
    expect((await adminDb.auditEvent.findMany({ where: { organizationId: w.org.id, action: "support_access.expired" } })).length).toBe(1);
    expect((await listAuditEvents({ organizationId: w.org.id, action: "support_access.expired" })).items).toHaveLength(1);
    // No extension without a new approval: the expired grant cannot be reopened, and Management cannot revive it.
    await expect(openSupportAccess(admin.actor, g.id)).rejects.toBeInstanceOf(ValidationError);
    await expect(decideSupportAccess(w.mgmt, g.id, "approve", undefined)).rejects.toBeInstanceOf(ValidationError);
  });

  it("a request nobody answers lapses after 24 hours and can no longer be approved", async () => {
    const w = await world();
    const g = await requestSupportAccess(admin.actor, req(w.org.id));
    await backdate(g.id, `request_expires_at = now() - interval '1 minute'`);
    await expect(decideSupportAccess(w.mgmt, g.id, "approve", undefined)).rejects.toMatchObject({ message: expect.stringContaining("expired") });
    expect(await expireSupportAccess(w.org.id)).toEqual({ expired: 1 });
    // And a fresh request can now be made.
    await expect(requestSupportAccess(admin.actor, req(w.org.id))).resolves.toMatchObject({ status: "PENDING" });
  });
});

describe("R4 and R5: read-only, and masked structurally", () => {
  it("returns named columns only: no deal value, note, custom field or payment, and masked emails and phones", async () => {
    const w = await world();
    const g = await active(w);
    const out: Record<string, unknown> = {};
    for (const resource of ["COMPANIES", "CONTACTS", "LEADS", "DEALS", "TASKS"]) out[resource] = await readSupportAccess(admin.actor, g.id, resource);
    const all = JSON.stringify(out);
    for (const secret of ["987654", "private price", SECRET_NOTE, "info@acme-sa", "jane.doe@acme-sa", "700123456", "711987654", "customFields", "custom_fields"]) expect(all).not.toContain(secret);

    const company = (out.COMPANIES as { items: Record<string, unknown>[] }).items[0]!;
    expect(company).toMatchObject({ id: w.company.id, email: "i***@acme-sa.example.com", phone: "***56" });
    expect(Object.keys(company).sort()).toEqual(["archived", "createdAt", "email", "id", "industry", "location", "name", "phone"]);
    const contact = (out.CONTACTS as { items: Record<string, unknown>[]; contactDetailsMasked: boolean });
    expect(contact.contactDetailsMasked).toBe(true);
    expect(contact.items[0]).toMatchObject({ email: "j***@acme-sa.example.com", phone: "***54", firstName: "Jane" });
    const deal = (out.DEALS as { items: Record<string, unknown>[] }).items[0]!;
    expect(Object.keys(deal).sort()).toEqual(["archived", "companyId", "createdAt", "expectedCloseDate", "id", "outcome", "stage"]);
    expect(deal.stage).toBeTruthy();
    expect((out.LEADS as { items: Record<string, unknown>[] }).items[0]).toMatchObject({ id: w.lead.id, status: "New" });
  });

  it("unmasking contact details is a separate request, and money is never shown either way", async () => {
    const w = await world();
    const g = await active(w, { unmaskContactDetails: true });
    const contacts = await readSupportAccess(admin.actor, g.id, "CONTACTS");
    expect(contacts.contactDetailsMasked).toBe(false);
    expect(contacts.items[0]).toMatchObject({ email: "jane.doe@acme-sa.example.com", phone: "+254711987654" });
    const deals = JSON.stringify(await readSupportAccess(admin.actor, g.id, "DEALS"));
    expect(deals).not.toContain("987654");
    expect(deals).not.toContain("value");
  });

  it("refuses a kind of record outside the approved scope, an unknown one, and pages within limits", async () => {
    const w = await world();
    const g = await active(w, { scope: ["COMPANIES"] });
    await expect(readSupportAccess(admin.actor, g.id, "DEALS")).rejects.toMatchObject({ status: 403, message: expect.stringContaining("not approved") });
    await expect(readSupportAccess(admin.actor, g.id, "PAYMENTS")).rejects.toMatchObject({ status: 403 });
    await adminDb.company.createMany({ data: Array.from({ length: 4 }, (_, i) => ({ organizationId: w.org.id, name: `Extra ${i}` })) });
    const page = await readSupportAccess(admin.actor, g.id, "COMPANIES", { limit: 2, offset: 0 });
    expect(page).toMatchObject({ total: 5, limit: 2, offset: 0 });
    expect(page.items).toHaveLength(2);
    expect((await readSupportAccess(admin.actor, g.id, "COMPANIES", { limit: 500, offset: 4 })).items).toHaveLength(1);
  });

  it("the platform database role has no privilege on any tenant record and cannot write one", async () => {
    const w = await world();
    const platform = getPlatformDb();
    await expect(platform.$queryRawUnsafe(`SELECT id FROM companies LIMIT 1`)).rejects.toThrow(/permission denied/);
    await expect(platform.$queryRawUnsafe(`SELECT id FROM deals LIMIT 1`)).rejects.toThrow(/permission denied/);
    await expect(platform.$executeRaw`INSERT INTO companies (id, organization_id, name) VALUES (gen_random_uuid()::text, ${w.org.id}, 'Planted')`).rejects.toThrow(/permission denied/);
    await expect(platform.$executeRaw`UPDATE companies SET name = 'Changed' WHERE organization_id = ${w.org.id}`).rejects.toThrow(/permission denied/);
    // Without a grant the function gives nothing, and a grant that is not open gives nothing.
    await expect(platform.$queryRaw`SELECT support_access_read('no-such-grant', ${admin.id}, 'x', 'COMPANIES', 10, 0)`).rejects.toThrow(/NO_GRANT/);
    const pending = await requestSupportAccess(admin.actor, req(w.org.id));
    await expect(platform.$queryRaw`SELECT support_access_read(${pending.id}, ${admin.id}, 'x', 'COMPANIES', 10, 0)`).rejects.toThrow(/NOT_ACTIVE/);
    expect((await adminDb.company.findFirstOrThrow({ where: { organizationId: w.org.id, name: { startsWith: "Acme" } } })).name).toContain("Acme");
  });
});

describe("R6 and R12: the grant reads its own organisation and nothing else", () => {
  it("a grant for A returns none of B's records, and the tenant role cannot call the read function", async () => {
    const a = await world("Iso A");
    const b = await world("Iso B");
    const g = await active(a);
    const seen = JSON.stringify(await Promise.all(["COMPANIES", "CONTACTS", "LEADS", "DEALS", "TASKS"].map((r) => readSupportAccess(admin.actor, g.id, r))));
    for (const id of [b.company.id, b.contact.id, b.lead.id, b.deal.id, b.task.id, b.org.id]) expect(seen).not.toContain(id);
    expect(seen).toContain(a.company.id);
    await expect(getUnscopedAppClientForTests().$queryRawUnsafe(`SELECT support_access_read('x','x','x','COMPANIES',1,0)`)).rejects.toThrow(/permission denied/);

    // B cannot see or decide A's grants.
    expect((await listOrganisationSupportAccess(b.mgmt)).items.map((i) => i.id)).not.toContain(g.id);
    await expect(getOrganisationSupportAccess(b.mgmt, g.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(decideSupportAccess(b.mgmt, g.id, "approve", undefined)).rejects.toBeInstanceOf(NotFoundError);
    await expect(endSupportAccessByOrganisation(b.mgmt, g.id)).rejects.toBeInstanceOf(NotFoundError);
    const rows = await withOrgContext(b.org.id, (tx) => tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM support_access_grants WHERE organization_id = $1`, a.org.id));
    expect(Number(rows[0]!.n)).toBe(0);
  });
});

describe("R7: everything is logged for the organisation and for the platform", () => {
  it("every page read is a row the organisation can read, with who, what and how many; and a platform audit entry with the reason and the ticket", async () => {
    const w = await world();
    const g = await active(w);
    await readSupportAccess(admin.actor, g.id, "COMPANIES");
    await readSupportAccess(admin.actor, g.id, "DEALS", { limit: 10, offset: 0 });

    const own = await getOrganisationSupportAccess(w.mgmt, g.id);
    expect(own.pageViews.map((v) => v.resource).sort()).toEqual(["COMPANIES", "DEALS"]);
    expect(own.pageViews[0]).toMatchObject({ by: admin.email, rows: 1 });
    await expect(getOrganisationSupportAccess(w.sales, g.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listOrganisationSupportAccess(w.sales)).rejects.toBeInstanceOf(ForbiddenError);

    const viewed = (await listAuditEvents({ organizationId: w.org.id, action: "support_access.viewed" })).items;
    expect(viewed).toHaveLength(2);
    expect(viewed[0]).toMatchObject({ actorLabel: admin.email, reason: "Customer cannot see their pipeline since Monday", metadata: { ticket: "SUP-1042" } });
    const lifecycle = (await listAuditEvents({ organizationId: w.org.id, limit: 100 })).items.map((e) => e.action);
    for (const a of ["support_access.requested", "support_access.approved", "support_access.opened"]) expect(lifecycle).toContain(a);
    const tenantActions = (await adminDb.auditEvent.findMany({ where: { organizationId: w.org.id, entityType: "SupportAccessGrant" } })).map((e) => e.action);
    expect(tenantActions.sort()).toEqual(["support_access.approved", "support_access.requested", "support_access.started"]);

    // Nobody can edit or delete the log.
    await expect(adminDb.$executeRaw`UPDATE support_access_page_views SET row_count = 0 WHERE grant_id = ${g.id}`).rejects.toThrow(/append-only/);
    await expect(getPlatformDb().$executeRaw`DELETE FROM support_access_page_views WHERE grant_id = ${g.id}`).rejects.toThrow();
    await expect(withOrgContext(w.org.id, (tx) => tx.$executeRaw`DELETE FROM support_access_page_views WHERE grant_id = ${g.id}`)).rejects.toThrow();
  });

  it("a refused read is itself in the platform audit log", async () => {
    const w = await world();
    const g = await active(w, { scope: ["COMPANIES"] });
    await expect(readSupportAccess(admin.actor, g.id, "DEALS")).rejects.toMatchObject({ status: 403 });
    const refused = (await listAuditEvents({ organizationId: w.org.id, action: "support_access.read_refused" })).items;
    expect(refused).toHaveLength(1);
    expect(refused[0]!.metadata).toMatchObject({ why: "OUT_OF_SCOPE", resource: "DEALS" });
  });
});

describe("ending early", () => {
  it("Management can end a session at any moment and the very next read is refused", async () => {
    const w = await world();
    const g = await active(w);
    await readSupportAccess(admin.actor, g.id, "COMPANIES");
    const ended = await endSupportAccessByOrganisation(w.mgmt, g.id);
    expect(ended).toMatchObject({ status: "ENDED", endReason: "ENDED_BY_ORGANISATION" });
    await expect(readSupportAccess(admin.actor, g.id, "COMPANIES")).rejects.toMatchObject({ status: 403 });
    await expect(endSupportAccessByOrganisation(w.sales, g.id)).rejects.toBeInstanceOf(ForbiddenError);
    // An ended session never comes back.
    await expect(
      adminDb.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SELECT set_config('app.support_actor', 'platform', true)`);
        await tx.$executeRawUnsafe(`UPDATE support_access_grants SET status = 'ACTIVE' WHERE id = '${g.id}'`);
      }),
    ).rejects.toThrow(/cannot move from ENDED/);
    // The organisation can ask again with a new request.
    await expect(requestSupportAccess(admin.actor, req(w.org.id))).resolves.toMatchObject({ status: "PENDING" });
  });

  it("the platform can end its own session or withdraw a request", async () => {
    const w = await world();
    const g = await active(w);
    expect(await endSupportAccess(admin.actor, g.id)).toMatchObject({ status: "ENDED", endedBy: admin.email });
    await expect(readSupportAccess(admin.actor, g.id, "COMPANIES")).rejects.toMatchObject({ status: 403 });
    const w2 = await world("Withdraw");
    const pending = await requestSupportAccess(admin.actor, req(w2.org.id));
    expect(await endSupportAccess(admin.actor, pending.id)).toMatchObject({ status: "CANCELLED" });
    await expect(decideSupportAccess(w2.mgmt, pending.id, "approve", undefined)).rejects.toBeInstanceOf(ValidationError);
  });

  it("a suspended organisation serves nothing, even to an open session", async () => {
    const w = await world();
    const g = await active(w);
    await transitionOrganization(admin.actor, w.org.id, "suspend", "Payment dispute under review");
    await expect(readSupportAccess(admin.actor, g.id, "COMPANIES")).rejects.toMatchObject({ status: 403, message: expect.stringContaining("not available") });
  });
});

describe("R9: the banner", () => {
  it("every member sees a running session; only Management sees the reason, the ticket and the waiting request", async () => {
    const w = await world();
    const g = await requestSupportAccess(admin.actor, req(w.org.id));
    expect((await getSupportBanner(w.sales)).pending).toBeNull();
    expect((await getSupportBanner(w.mgmt)).pending).toMatchObject({ id: g.id, ticketReference: "SUP-1042", status: "PENDING" });
    expect((await getSupportBanner(w.mgmt)).active).toBeNull();

    await decideSupportAccess(w.mgmt, g.id, "approve", undefined);
    await openSupportAccess(admin.actor, g.id);
    const salesView = await getSupportBanner(w.sales);
    expect(salesView.active).toMatchObject({ id: g.id, contactDetailsMasked: true, scope: expect.any(Array) });
    expect(JSON.stringify(salesView)).not.toContain("SUP-1042");
    expect(JSON.stringify(salesView)).not.toContain("pipeline");
    expect(salesView.active!.secondsLeft).toBeGreaterThan(0);
    expect((await getSupportBanner(w.mgmt)).active).toMatchObject({ requestedBy: admin.email, ticketReference: "SUP-1042" });

    await endSupportAccess(admin.actor, g.id);
    expect((await getSupportBanner(w.sales)).active).toBeNull();
    const ended = await adminDb.notification.findMany({ where: { organizationId: w.org.id, type: "SUPPORT_ACCESS_REQUEST" }, orderBy: { createdAt: "asc" } });
    expect(ended.map((n) => n.title)).toEqual([
      "Figbloom support asks to view your organisation",
      "A Figbloom support session has started",
      "The Figbloom support session has ended",
    ]);
  });
});

describe("the routes", () => {
  it("answer 404 to non-admins and below V2; need a fresh second step to request and to open; and the organisation routes need release V2", async () => {
    const w = await world();
    holder.jar = cookieJar({});
    expect((await requestRoute.GET(jsonRequest("/api/platform/support-access", "GET"))).status).toBe(404);
    holder.jar = admin.jar;
    process.env.ACTIVE_RELEASE = "v1.1";
    expect((await requestRoute.GET(jsonRequest("/api/platform/support-access", "GET"))).status).toBe(404);
    process.env.ACTIVE_RELEASE = "v2";

    const stale = await makePlatformAdmin("support-stale");
    await getPlatformDb().platformSession.updateMany({ where: { platformIdentityId: stale.id }, data: { verifiedAt: new Date(Date.now() - 24 * HOUR) } });
    holder.jar = stale.jar;
    const refused = await requestRoute.POST(jsonRequest("/api/platform/support-access", "POST", req(w.org.id)));
    expect(refused.status).toBe(403);
    expect((await refused.json()).message).toContain("Verify it's you");

    holder.jar = admin.jar;
    const made = await requestRoute.POST(jsonRequest("/api/platform/support-access", "POST", req(w.org.id)));
    expect(made.status).toBe(200);
    const grant = await made.json();

    holder.ctx = w.mgmt;
    const decide = await decisionRoute.POST(jsonRequest("/x", "POST", { decision: "approve" }), ctxParams({ orgSlug: w.org.slug, grantId: grant.id }));
    expect(decide.status).toBe(200);
    holder.ctx = w.sales;
    expect((await decisionRoute.POST(jsonRequest("/x", "POST", { decision: "deny" }), ctxParams({ orgSlug: w.org.slug, grantId: grant.id }))).status).toBe(403);
    expect((await bannerRoute.GET(jsonRequest("/x", "GET"), ctxParams({ orgSlug: w.org.slug }))).status).toBe(200);

    // A session whose second step is old cannot open a grant (R8), a fresh one can.
    const staleOpen = await getPlatformDb().platformSession.updateMany({ where: { platformIdentityId: admin.id }, data: { verifiedAt: new Date(Date.now() - 24 * HOUR) } });
    expect(staleOpen.count).toBeGreaterThan(0);
    holder.jar = admin.jar;
    const noOpen = await openRoute.POST(jsonRequest("/x", "POST"), ctxParams({ grantId: grant.id }));
    expect(noOpen.status).toBe(403);
    await getPlatformDb().platformSession.updateMany({ where: { platformIdentityId: admin.id }, data: { verifiedAt: new Date() } });
    const open = await openRoute.POST(jsonRequest("/x", "POST"), ctxParams({ grantId: grant.id }));
    expect(open.status).toBe(200);

    const read = await readRoute.GET(jsonRequest(`/x?resource=COMPANIES`, "GET"), ctxParams({ grantId: grant.id }));
    expect(read.status).toBe(200);
    expect((await read.json()).total).toBe(1);
    expect((await readRoute.GET(jsonRequest(`/x`, "GET"), ctxParams({ grantId: grant.id }))).status).toBe(400);

    await setOrganizationRelease(w.org.id, "v1.1");
    holder.ctx = w.mgmt;
    const closed = await bannerRoute.GET(jsonRequest("/x", "GET"), ctxParams({ orgSlug: w.org.slug }));
    expect(closed.status).toBe(403);
    expect((await closed.json()).code).toBe("FEATURE_UNAVAILABLE");
  });
});
