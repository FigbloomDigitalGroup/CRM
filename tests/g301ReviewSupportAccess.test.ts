/**
 * G3.01 independent security review (FIG-1191), support access / break-glass (FIG-1183): attacks written by the reviewer at the service, at
 * the database functions and triggers, and as each database role. A passing test shows a defence holds. A test marked `it.fails` is a
 * confirmed gap, written up in docs/M17_SECURITY_REVIEW_G3_01.md.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { getUnscopedAppClientForTests, withOrgContext } from "../src/db/orgScopedClient";
import { getPlatformDb } from "../src/db/platformClient";
import { setOrganizationRelease } from "../src/services/featureService";
import { decideSupportAccess, endSupportAccessByOrganisation, openSupportAccess, readSupportAccess, requestSupportAccess, type SupportRequestInput } from "../src/services/supportAccessService";
import { createTestContext, createTestOrganization, getLeadStatusId, getPipelineStageId } from "./helpers/fixtures";
import { makePlatformAdmin, removeTestPlatformAdmins, type TestPlatformAdmin } from "./helpers/platform";

const NOTE = "G301-NOTE-SENTINEL private price talk";
const VALUE = "9876543.21";
const WEBSITE = "https://g301-website-sentinel.example.com";
const EMAIL = "jane.g301@acme-g301.example.com";
const PHONE = "+254711987654";
const previousRelease = process.env.ACTIVE_RELEASE;
let admin: TestPlatformAdmin;
let rogue: TestPlatformAdmin;

beforeAll(async () => {
  process.env.ACTIVE_RELEASE = "v2";
  admin = await makePlatformAdmin("g301-admin");
  rogue = await makePlatformAdmin("g301-rogue");
});
afterAll(async () => {
  if (previousRelease === undefined) delete process.env.ACTIVE_RELEASE;
  else process.env.ACTIVE_RELEASE = previousRelease;
  await removeTestPlatformAdmins();
  await getPlatformDb().$disconnect();
});

async function world(label = "G301 Support") {
  const org = await createTestOrganization(label);
  await setOrganizationRelease(org.id, "v2");
  const tag = org.slug.slice(-6);
  const mgmt = await createTestContext(org.id, "MANAGEMENT", `g301.mgmt.${tag}`);
  const sales = await createTestContext(org.id, "SALES", `g301.sales.${tag}`);
  const company = await adminDb.company.create({
    data: { organizationId: org.id, name: `Acme ${tag}`, email: EMAIL, phone: PHONE, website: WEBSITE, notes: NOTE, customFields: { secret: NOTE } },
  });
  const contact = await adminDb.contact.create({ data: { organizationId: org.id, companyId: company.id, firstName: "Jane", lastName: "Doe", email: EMAIL, phone: PHONE, notes: NOTE } });
  const lead = await adminDb.lead.create({ data: { organizationId: org.id, companyId: company.id, contactId: contact.id, leadStatusId: await getLeadStatusId(org.id), notes: NOTE } });
  const deal = await adminDb.deal.create({ data: { organizationId: org.id, companyId: company.id, ownerMembershipId: mgmt.membershipId, pipelineStageId: await getPipelineStageId(org.id), value: VALUE, notes: NOTE } });
  await adminDb.task.create({ data: { organizationId: org.id, title: NOTE, description: NOTE, assigneeMembershipId: mgmt.membershipId, createdByMembershipId: mgmt.membershipId, dealId: deal.id } });
  return { org, mgmt, sales, company, contact, lead, deal };
}

const req = (orgId: string, o: Partial<SupportRequestInput> = {}): SupportRequestInput => ({
  organizationId: orgId,
  reason: "Customer cannot see their pipeline since Monday",
  ticketReference: "SUP-G301",
  scope: ["COMPANIES", "CONTACTS", "LEADS", "DEALS", "TASKS"],
  durationMinutes: 30,
  ...o,
});
type W = Awaited<ReturnType<typeof world>>;
const approved = async (w: W, o: Partial<SupportRequestInput> = {}) => {
  const g = await requestSupportAccess(admin.actor, req(w.org.id, o));
  await decideSupportAccess(w.mgmt, g.id, "approve", "ok");
  return g;
};
const active = async (w: W, o: Partial<SupportRequestInput> = {}) => openSupportAccess(admin.actor, (await approved(w, o)).id);
const tenantSql = (orgId: string, sql: string, ...args: unknown[]) => withOrgContext(orgId, (tx) => tx.$executeRawUnsafe(sql, ...args));

describe("G3.01 support access: no read without an approved, open, unexpired grant", () => {
  it("every state short of ACTIVE refuses every kind of read, for the requesting admin and for another admin", async () => {
    const w = await world();
    const g = await requestSupportAccess(admin.actor, req(w.org.id));
    for (const actor of [admin.actor, rogue.actor]) {
      await expect(readSupportAccess(actor, g.id, "COMPANIES")).rejects.toMatchObject({ status: 403 }); // PENDING
    }
    await decideSupportAccess(w.mgmt, g.id, "approve", "ok");
    await expect(readSupportAccess(admin.actor, g.id, "COMPANIES")).rejects.toMatchObject({ status: 403 }); // APPROVED but not opened
    const opened = await openSupportAccess(admin.actor, g.id);
    expect((await readSupportAccess(admin.actor, g.id, "COMPANIES")).items.length).toBeGreaterThan(0);
    // The session belongs to the admin who opened it: another platform admin holding the grant id gets nothing.
    await expect(readSupportAccess(rogue.actor, g.id, "COMPANIES")).rejects.toMatchObject({ status: 403 });
    await endSupportAccessByOrganisation(w.mgmt, opened.id);
    await expect(readSupportAccess(admin.actor, g.id, "COMPANIES")).rejects.toMatchObject({ status: 403 }); // replay after the end
  });

  it("another platform admin cannot open a grant someone else asked for, and a denied, ended or expired grant cannot be opened again", async () => {
    const w = await world();
    const g = await approved(w);
    await expect(openSupportAccess(rogue.actor, g.id)).rejects.toMatchObject({ name: "ValidationError" });
    const w2 = await world();
    const denied = await requestSupportAccess(admin.actor, req(w2.org.id));
    await decideSupportAccess(w2.mgmt, denied.id, "deny", "no");
    await expect(openSupportAccess(admin.actor, denied.id)).rejects.toMatchObject({ name: "ValidationError" });
    const w3 = await world();
    const ended = await active(w3);
    await endSupportAccessByOrganisation(w3.mgmt, ended.id);
    await expect(openSupportAccess(admin.actor, ended.id)).rejects.toMatchObject({ name: "ValidationError" });
    // Approved, but the hour to open it has gone: the database function itself refuses (the trigger checks the approval's age).
    const w4 = await world();
    const stale = await approved(w4);
    await adminDb.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
      await tx.$executeRawUnsafe(`UPDATE support_access_grants SET decided_at = now() - interval '2 hours' WHERE id = '${stale.id}'`);
    });
    await expect(openSupportAccess(admin.actor, stale.id)).rejects.toMatchObject({ name: "ValidationError" });
    await expect(readSupportAccess(admin.actor, stale.id, "COMPANIES")).rejects.toMatchObject({ status: 403 });
  });

  it("the window is enforced by the database clock on every read: a session whose end has passed reads nothing, with no job having run", async () => {
    const w = await world();
    const g = await active(w);
    await adminDb.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
      await tx.$executeRawUnsafe(`UPDATE support_access_grants SET starts_at = now() - interval '40 minutes', ends_at = now() - interval '10 minutes' WHERE id = '${g.id}'`);
    });
    expect((await adminDb.supportAccessGrant.findUniqueOrThrow({ where: { id: g.id } })).status).toBe("ACTIVE"); // the job has not marked it
    await expect(readSupportAccess(admin.actor, g.id, "COMPANIES")).rejects.toMatchObject({ status: 403 });
    // A window that has not started yet reads nothing either.
    await adminDb.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
      await tx.$executeRawUnsafe(`UPDATE support_access_grants SET starts_at = now() + interval '10 minutes', ends_at = now() + interval '40 minutes' WHERE id = '${g.id}'`);
    });
    await expect(readSupportAccess(admin.actor, g.id, "COMPANIES")).rejects.toMatchObject({ status: 403 });
  });

  it("a grant id of one organisation never opens another's records, and every read is logged in the grant's own organisation only", async () => {
    const a = await world("G301 A");
    const b = await world("G301 B");
    const g = await active(a);
    const out = JSON.stringify(await readSupportAccess(admin.actor, g.id, "COMPANIES"));
    expect(out).toContain(a.company.id);
    expect(out).not.toContain(b.company.id);
    expect(await adminDb.supportAccessPageView.count({ where: { organizationId: b.org.id } })).toBe(0);
    expect(await adminDb.supportAccessPageView.count({ where: { organizationId: a.org.id, grantId: g.id } })).toBe(1);
    await expect(decideSupportAccess(b.mgmt, g.id, "approve", "x")).rejects.toMatchObject({ name: "NotFoundError" });
  });

  it("only Management (security.manage) decides: Sales, and a custom role with every grantable key, are refused", async () => {
    const w = await world();
    const g = await requestSupportAccess(admin.actor, req(w.org.id));
    await expect(decideSupportAccess(w.sales, g.id, "approve", "x")).rejects.toMatchObject({ name: "ForbiddenError" });
    const { createRole } = await import("../src/services/roleEditorService");
    const { grantableKeys } = await import("../src/lib/roleLimits");
    const role = await createRole(w.mgmt, { name: "Almost Everything", permissionKeys: grantableKeys().filter((k) => !k.includes("view.value")) });
    const { createTestMembership } = await import("./helpers/fixtures");
    const { resolveActiveMembership } = await import("../src/repositories/memberships");
    const { user, membership } = await createTestMembership(w.org.id, "SALES", "g301.custom");
    await adminDb.membership.update({ where: { id: membership.id }, data: { roleId: role.id } });
    const customCtx = (await resolveActiveMembership(user.id, w.org.id))!;
    await expect(decideSupportAccess(customCtx, g.id, "approve", "x")).rejects.toMatchObject({ name: "ForbiddenError" });
    expect((await adminDb.supportAccessGrant.findUniqueOrThrow({ where: { id: g.id } })).status).toBe("PENDING");
  });
});

describe("G3.01 support access: what a session can read (masking is structural)", () => {
  it("no sentinel note, value, website, custom field, task text or unmasked contact detail appears in any resource, at any page size", async () => {
    const w = await world();
    const g = await active(w);
    const all = JSON.stringify(
      await Promise.all(["COMPANIES", "CONTACTS", "LEADS", "DEALS", "TASKS"].flatMap((r) => [readSupportAccess(admin.actor, g.id, r), readSupportAccess(admin.actor, g.id, r, { limit: 1_000_000, offset: -5 })])),
    );
    for (const secret of [NOTE, "9876543", VALUE, "g301-website-sentinel", EMAIL, PHONE, "jane.g301", "987654"]) expect(all, secret).not.toContain(secret);
    expect(all).toContain("***"); // masked, not absent
    expect(all).toContain(w.deal.id); // control: the data is really there
  });

  it("the page size is clamped by the database (50), a negative offset is zero, and an unknown, differently-cased or injected kind is refused", async () => {
    const w = await world();
    const g = await active(w);
    const page = await readSupportAccess(admin.actor, g.id, "COMPANIES", { limit: 1_000_000, offset: -9 });
    expect(page.limit).toBe(50);
    expect(page.offset).toBe(0);
    for (const kind of ["companies", "COMPANIES' OR '1'='1", "PAYMENTS", "INVOICES", "FILES", "COMPANIES;DROP TABLE companies", ""]) {
      await expect(readSupportAccess(admin.actor, g.id, kind), kind).rejects.toMatchObject({ status: 403 });
    }
    expect(await adminDb.company.count({ where: { organizationId: w.org.id } })).toBeGreaterThan(0);
  });

  it("a session approved for one kind of record reads no other, and asking for the unmasked contact details is a separate approval", async () => {
    const w = await world();
    const g = await active(w, { scope: ["TASKS"] });
    await expect(readSupportAccess(admin.actor, g.id, "CONTACTS")).rejects.toMatchObject({ status: 403 });
    await expect(readSupportAccess(admin.actor, g.id, "DEALS")).rejects.toMatchObject({ status: 403 });
    const w2 = await world();
    const g2 = await active(w2, { scope: ["CONTACTS"], unmaskContactDetails: true });
    expect(JSON.stringify(await readSupportAccess(admin.actor, g2.id, "CONTACTS"))).toContain(EMAIL); // approved: shown
    // ...and still no money, notes or custom fields, even with the unmask approval.
    const wide = JSON.stringify(await Promise.all(["COMPANIES", "DEALS"].map((r) => readSupportAccess(admin.actor, g2.id, r).catch(() => null))));
    expect(wide).not.toMatch(/9876543|G301-NOTE|g301-website/);
  });
});

describe("G3.01 support access: the database walls, by role", () => {
  it("the platform role cannot read or write the grant table or the page-view log, and cannot become the platform actor by setting the flag itself", async () => {
    const w = await world();
    const g = await requestSupportAccess(admin.actor, req(w.org.id));
    const platform = getPlatformDb();
    await expect(platform.$queryRawUnsafe(`SELECT * FROM support_access_grants`)).rejects.toThrow(/permission denied/);
    await expect(platform.$queryRawUnsafe(`SELECT * FROM support_access_page_views`)).rejects.toThrow(/permission denied/);
    await expect(
      platform.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SELECT set_config('app.support_actor', 'platform', true)`);
        await tx.$executeRawUnsafe(`UPDATE support_access_grants SET status = 'APPROVED' WHERE id = '${g.id}'`);
      }),
    ).rejects.toThrow(/permission denied/);
    await expect(platform.$executeRawUnsafe(`INSERT INTO support_access_page_views (organization_id, grant_id, identity_label, resource) VALUES ('${w.org.id}', '${g.id}', 'forged', 'COMPANIES')`)).rejects.toThrow(/permission denied/);
    // The platform's own functions cannot approve: only request, open, end, read and list exist for it.
    await expect(platform.$queryRawUnsafe(`SELECT * FROM support_access_open('${g.id}', '${admin.id}', now()::timestamp)`)).resolves.toHaveLength(0); // PENDING is not APPROVED: nothing moves
    expect((await adminDb.supportAccessGrant.findUniqueOrThrow({ where: { id: g.id } })).status).toBe("PENDING");
  });

  it("the tenant role, as the organisation, cannot create, open, extend, rewrite or delete a grant, or edit or delete the page-view log", async () => {
    const w = await world();
    const pending = await requestSupportAccess(admin.actor, req(w.org.id));
    // A request is made by the platform, never by the tenant role.
    await expect(tenantSql(w.org.id, `INSERT INTO support_access_grants (id, organization_id, requested_by_identity_id, requested_by_label, reason, ticket_reference, scope, duration_minutes, request_expires_at) VALUES (gen_random_uuid()::text, $1, 'x', 'x', 'a valid reason here', 'TKT-1', ARRAY['COMPANIES'], 30, now() + interval '1 day')`, w.org.id)).rejects.toThrow(/Only the platform asks|permission/i);
    // PENDING cannot skip to ACTIVE.
    await expect(tenantSql(w.org.id, `UPDATE support_access_grants SET status = 'ACTIVE', opened_at = now(), opened_by_identity_id = requested_by_identity_id, starts_at = now(), ends_at = now() + interval '30 minutes' WHERE id = $1`, pending.id)).rejects.toThrow(/cannot move/);
    await decideSupportAccess(w.mgmt, pending.id, "approve", "ok");
    // APPROVED cannot be opened by the tenant side either.
    await expect(tenantSql(w.org.id, `UPDATE support_access_grants SET status = 'ACTIVE', opened_at = now(), opened_by_identity_id = requested_by_identity_id, starts_at = now(), ends_at = now() + interval '30 minutes' WHERE id = $1`, pending.id)).rejects.toThrow(/cannot move/);
    const g = await openSupportAccess(admin.actor, pending.id);
    // A running window cannot be lengthened, moved or reassigned, and what was asked for cannot be widened.
    await expect(tenantSql(w.org.id, `UPDATE support_access_grants SET ends_at = ends_at + interval '10 hours' WHERE id = $1`, g.id)).rejects.toThrow(/cannot be rewritten/);
    await expect(tenantSql(w.org.id, `UPDATE support_access_grants SET starts_at = starts_at + interval '1 hour' WHERE id = $1`, g.id)).rejects.toThrow(/cannot be rewritten/);
    await expect(tenantSql(w.org.id, `UPDATE support_access_grants SET scope = ARRAY['COMPANIES','CONTACTS','LEADS','DEALS','TASKS'], duration_minutes = 120, unmask_contact_details = true WHERE id = $1`, g.id)).rejects.toThrow(/cannot be changed/);
    await expect(tenantSql(w.org.id, `DELETE FROM support_access_grants WHERE id = $1`, g.id)).rejects.toThrow(/never deleted|permission/i);
    // The log of what support looked at.
    await readSupportAccess(admin.actor, g.id, "COMPANIES");
    await expect(tenantSql(w.org.id, `UPDATE support_access_page_views SET row_count = 0 WHERE grant_id = $1`, g.id)).rejects.toThrow(/append-only|permission/i);
    await expect(tenantSql(w.org.id, `DELETE FROM support_access_page_views WHERE grant_id = $1`, g.id)).rejects.toThrow(/append-only|permission/i);
    // A decided request cannot be re-decided: DENIED cannot become APPROVED, ENDED cannot become ACTIVE.
    const w2 = await world();
    const d = await requestSupportAccess(admin.actor, req(w2.org.id));
    await decideSupportAccess(w2.mgmt, d.id, "deny", "no");
    await expect(tenantSql(w2.org.id, `UPDATE support_access_grants SET status = 'APPROVED', decided_at = now(), decided_by_membership_id = 'x' WHERE id = $1`, d.id)).rejects.toThrow(/cannot move/);
  });

  it("one organisation's context cannot read, change or approve another's grants through SQL", async () => {
    const a = await world("G301 RLS A");
    const b = await world("G301 RLS B");
    const g = await requestSupportAccess(admin.actor, req(a.org.id));
    expect(await withOrgContext(b.org.id, (tx) => tx.supportAccessGrant.count({ where: { id: g.id } }))).toBe(0);
    expect(await tenantSql(b.org.id, `UPDATE support_access_grants SET status = 'APPROVED', decided_at = now(), decided_by_membership_id = 'x' WHERE id = $1`, g.id)).toBe(0);
    expect(await getUnscopedAppClientForTests().supportAccessGrant.count({ where: { id: g.id } })).toBe(0); // no organisation set: nothing is visible
    expect((await adminDb.supportAccessGrant.findUniqueOrThrow({ where: { id: g.id } })).status).toBe("PENDING");
  });

  // FINDING (Low, defence in depth): the migration says the schema owner "may let things lapse but can never approve for the organisation or
  // open". The trigger does not do that: `allowed := NOT platform_side` for PENDING -> APPROVED and `allowed := NOT tenant_side` for APPROVED ->
  // ACTIVE are both true for the owner (neither tenant nor platform). The application's own `adminDb` connection is the owner, so any code path
  // that reaches it with attacker-influenced SQL can approve and open a break-glass session without Management. (A holder of the owner connection
  // can read every tenant row anyway; this is about the stated guarantee "no application bug can turn a request into a session".)
  it.fails("the schema owner connection cannot approve a request for the organisation, nor open an approved one", async () => {
    const w = await world();
    const g = await requestSupportAccess(admin.actor, req(w.org.id));
    await expect(
      adminDb.$executeRawUnsafe(`UPDATE support_access_grants SET status = 'APPROVED', decided_at = now(), decided_by_membership_id = 'forged' WHERE id = '${g.id}'`),
    ).rejects.toThrow();
  });

  // FINDING (Low): `support_access_open` takes the start of the window from its caller (`p_now`), and the trigger only checks that the end is
  // start + the approved minutes. A platform-role caller may therefore open an approved request with a window that starts days from now (or ends
  // already), so the "approval is good for one hour" rule applies to the moment of opening, not to the moment the data can be read.
  it.fails("a window cannot be opened to start far from the moment of opening", async () => {
    const w = await world();
    const g = await approved(w);
    const later = new Date(Date.now() + 5 * 24 * 3_600_000).toISOString();
    const rows = await getPlatformDb().$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM support_access_open('${g.id}', '${admin.id}', '${later}'::timestamp)`).catch(() => []);
    expect(rows).toHaveLength(0);
  });
});
