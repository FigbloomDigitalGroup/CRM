import { describe, expect, it } from "vitest";
import { ForbiddenError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { recordAuditEvent } from "../src/repositories/auditEvents";
import * as auditService from "../src/services/auditService";
import {
  exportOrganizationAuditLogCsv,
  getAuditLogFilters,
  listOrganizationAuditLog,
} from "../src/services/auditLogService";
import { createCompany, updateCompany } from "../src/services/companyService";
import * as integrationService from "../src/services/integrationService";
import * as leadService from "../src/services/leadService";
import { changeMemberRole, inviteMember } from "../src/services/membershipService";
import { createInvoice } from "../src/services/paymentService";
import { createTestContext, createTestMembership, createTestOrganization, getLeadStatusId } from "./helpers/fixtures";
import { createCompanyRow } from "./helpers/stage3";

describe("organisation-wide audit log (FIG-799)", () => {
  it("lists every event for the organisation, newest first, with who did it and a link to the record", async () => {
    const org = await createTestOrganization("AuditLog");
    const admin = await createTestContext(org.id, "MANAGEMENT", "audit.admin");
    const { company } = await createCompany(admin, { name: "Before Co" });
    await updateCompany(admin, company.id, { name: "Linked Co" });

    const page = await listOrganizationAuditLog(admin);
    expect(page.total).toBeGreaterThan(0);
    const updated = page.items.find((e) => e.action === "company.updated")!;
    expect(updated.actor.name).toBeTruthy();
    expect(updated.actor.membershipId).toBe(admin.membershipId);
    expect(updated.actor.roleKey).toBe("MANAGEMENT");
    expect(updated.entity).toMatchObject({ type: "Company", id: company.id, label: "Linked Co", exists: true, archived: false });
    expect(updated.entity.link?.path).toBe(`/o/${org.slug}/companies/${company.id}`);
    // Newest first.
    const times = page.items.map((e) => e.at.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("filters by actor, entity type, action (exact and prefix) and date range", async () => {
    const org = await createTestOrganization("AuditFilter");
    const admin = await createTestContext(org.id, "MANAGEMENT", "audit.admin");
    const sales = await createTestContext(org.id, "SALES", "audit.sales");
    const { company } = await createCompany(sales, { name: "Sales Co" });
    await updateCompany(sales, company.id, { name: "Sales Co Renamed" });
    const { lead } = await leadService.createLead(admin, { leadStatusId: await getLeadStatusId(org.id) });
    await leadService.assignLead(admin, lead.id, sales.membershipId);

    const bySales = await listOrganizationAuditLog(admin, { actorMembershipId: sales.membershipId });
    expect(bySales.items.length).toBeGreaterThan(0);
    expect(bySales.items.every((e) => e.actor.membershipId === sales.membershipId)).toBe(true);

    const byType = await listOrganizationAuditLog(admin, { entityType: "Lead" });
    expect(byType.items.every((e) => e.entity.type === "Lead")).toBe(true);
    expect(byType.items.length).toBeGreaterThan(0);

    const exact = await listOrganizationAuditLog(admin, { action: "lead.owner_reassigned" });
    expect(exact.items.every((e) => e.action === "lead.owner_reassigned")).toBe(true);
    const prefix = await listOrganizationAuditLog(admin, { action: "company.*" });
    expect(prefix.items.length).toBeGreaterThan(0);
    expect(prefix.items.every((e) => e.action.startsWith("company."))).toBe(true);

    // Date range: inclusive days, UTC.
    const old = await recordAuditEvent({ organizationId: org.id, actorMembershipId: admin.membershipId, action: "test.old", entityType: "Thing" });
    await adminDb.$executeRaw`UPDATE audit_events SET created_at = ${new Date("2026-01-15T12:00:00.000Z")} WHERE id = ${old.id}`;
    const jan = await listOrganizationAuditLog(admin, { dateFrom: "2026-01-15", dateTo: "2026-01-15" });
    expect(jan.items.map((e) => e.action)).toEqual(["test.old"]);
    const none = await listOrganizationAuditLog(admin, { dateFrom: "2026-01-16", dateTo: "2026-01-20" });
    expect(none.items).toHaveLength(0);
    await expect(listOrganizationAuditLog(admin, { dateFrom: "2026-02-02", dateTo: "2026-02-01" })).rejects.toThrow(ValidationError);
    await expect(listOrganizationAuditLog(admin, { dateFrom: "yesterday" })).rejects.toThrow(ValidationError);
  });

  it("pages through the log with a total and a cursor", async () => {
    const org = await createTestOrganization("AuditPaging");
    const admin = await createTestContext(org.id, "MANAGEMENT", "audit.admin");
    for (let i = 0; i < 7; i++) {
      await recordAuditEvent({ organizationId: org.id, actorMembershipId: admin.membershipId, action: `test.event_${i}`, entityType: "Thing", entityId: `t${i}` });
    }
    const first = await listOrganizationAuditLog(admin, { entityType: "Thing" }, { pageSize: 3 });
    expect(first.total).toBe(7);
    expect(first.items).toHaveLength(3);
    expect(first.nextCursor).not.toBeNull();
    const second = await listOrganizationAuditLog(admin, { entityType: "Thing" }, { pageSize: 3, cursor: first.nextCursor! });
    const third = await listOrganizationAuditLog(admin, { entityType: "Thing" }, { pageSize: 3, cursor: second.nextCursor! });
    const ids = [...first.items, ...second.items, ...third.items].map((e) => e.id);
    expect(new Set(ids).size).toBe(7);
    expect(third.nextCursor).toBeNull();
  });

  it("still renders rows for records that were deleted or archived", async () => {
    const org = await createTestOrganization("AuditGone");
    const admin = await createTestContext(org.id, "MANAGEMENT", "audit.admin");
    const { company } = await createCompany(admin, { name: "Soon Gone Co" });
    await recordAuditEvent({ organizationId: org.id, actorMembershipId: admin.membershipId, action: "company.deleted_test", entityType: "Company", entityId: company.id, previousValue: { name: "Soon Gone Co" } });
    await adminDb.company.update({ where: { id: company.id }, data: { archivedAt: new Date() } });

    const archived = await listOrganizationAuditLog(admin, { entityId: company.id });
    expect(archived.items.length).toBeGreaterThan(0);
    expect(archived.items.every((e) => e.entity.exists && e.entity.archived)).toBe(true);

    // Delete the record outright (a hard delete, as the erasure path does): the row stays, named from what the event recorded.
    await adminDb.company.delete({ where: { id: company.id } });
    const gone = await listOrganizationAuditLog(admin, { entityId: company.id });
    expect(gone.items.length).toBeGreaterThan(0);
    const row = gone.items.find((e) => e.action === "company.deleted_test")!;
    expect(row.entity).toMatchObject({ exists: false, label: "Soon Gone Co", link: null });
  });

  it("is for audit.view only", async () => {
    const org = await createTestOrganization("AuditPerm");
    for (const role of ["SALES", "DELIVERY", "FINANCE", "RESTRICTED_TECHNICAL"] as const) {
      const ctx = await createTestContext(org.id, role, `audit.${role}`);
      await expect(listOrganizationAuditLog(ctx)).rejects.toThrow(ForbiddenError);
      await expect(getAuditLogFilters(ctx)).rejects.toThrow(ForbiddenError);
      await expect(exportOrganizationAuditLogCsv(ctx)).rejects.toThrow(ForbiddenError);
    }
  });

  it("never shows another organisation's events", async () => {
    const a = await createTestOrganization("AuditIsoA");
    const b = await createTestOrganization("AuditIsoB");
    const adminA = await createTestContext(a.id, "MANAGEMENT", "audit.a");
    const adminB = await createTestContext(b.id, "MANAGEMENT", "audit.b");
    await recordAuditEvent({ organizationId: a.id, actorMembershipId: adminA.membershipId, action: "test.secret_a", entityType: "Thing", entityId: "a1" });
    const seenByB = await listOrganizationAuditLog(adminB);
    expect(seenByB.items.some((e) => e.action === "test.secret_a")).toBe(false);
    // Asking B's log for A's entity id finds nothing.
    expect((await listOrganizationAuditLog(adminB, { entityId: "a1" })).total).toBe(0);
  });

  it("gives the filter controls: entity types, actions and the people who acted", async () => {
    const org = await createTestOrganization("AuditFacets");
    const admin = await createTestContext(org.id, "MANAGEMENT", "audit.admin");
    const { company } = await createCompany(admin, { name: "Facet Co" });
    await updateCompany(admin, company.id, { name: "Facet Co Renamed" });
    const facets = await getAuditLogFilters(admin);
    expect(facets.entityTypes.map((t) => t.value)).toContain("Company");
    expect(facets.actions.map((t) => t.value)).toContain("company.updated");
    expect(facets.actors.map((a) => a.membershipId)).toContain(admin.membershipId);
  });

  it("exports what the filters show as CSV, and audits the export itself", async () => {
    const org = await createTestOrganization("AuditExport");
    const admin = await createTestContext(org.id, "MANAGEMENT", "audit.admin");
    const { company } = await createCompany(admin, { name: "Before Export Co" });
    await updateCompany(admin, company.id, { name: "Export, \"Quoted\" Co" });

    const csv = await exportOrganizationAuditLogCsv(admin, { entityType: "Company" });
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("when,actor,actorRole,action,entityType,entityId,entity,recordExists,recordArchived,previousValue,newValue,metadata");
    expect(lines.length).toBe(2);
    expect(csv).toContain("company.updated");
    expect(csv).toContain('"Export, ""Quoted"" Co"');

    const exported = await adminDb.auditEvent.findMany({ where: { organizationId: org.id, action: "audit_log.exported" } });
    expect(exported).toHaveLength(1);
  });
});

describe("what the log records (FIG-799: exports, imports, member and role changes, key rotations)", () => {
  it("has events for a member invite, a role change, a key rotation and an export", async () => {
    const org = await createTestOrganization("AuditCoverage");
    const admin = await createTestContext(org.id, "MANAGEMENT", "audit.admin");
    const other = await createTestMembership(org.id, "SALES", "audit.other");

    await inviteMember(admin, { email: `invitee.${Date.now()}@example.test`, name: "Invitee", roleKey: "SALES" }, (t) => `https://x.test/${t}`);
    await changeMemberRole(admin, other.membership.id, "DELIVERY");
    await integrationService.regenerateWebsiteApiKey(admin);
    await integrationService.regenerateInboundEmailKey(admin);
    await exportOrganizationAuditLogCsv(admin);

    const actions = (await listOrganizationAuditLog(admin, {}, { pageSize: 100 })).items.map((e) => e.action);
    for (const expected of ["membership.invited", "membership.role_changed", "website_api_key.regenerated", "inbound_email_key.regenerated", "audit_log.exported"]) {
      expect(actions).toContain(expected);
    }
  });
});

describe("masking in the audit log (payments and deal values)", () => {
  async function organisationWithInvoiceAndDealChange() {
    const org = await createTestOrganization("AuditMask");
    const admin = await createTestContext(org.id, "MANAGEMENT", "audit.admin");
    const finance = await createTestContext(org.id, "FINANCE", "audit.finance");
    const company = await createCompanyRow(org.id);
    await createInvoice(finance, { number: "INV-AUDIT-777", amount: 123456, issuedOn: "2026-10-01", dueOn: "2026-10-20", companyId: company.id });
    await recordAuditEvent({
      organizationId: org.id,
      actorMembershipId: admin.membershipId,
      action: "deal.updated",
      entityType: "Deal",
      entityId: "deal-x",
      previousValue: { value: "11111.00", notes: "kept" },
      newValue: { value: "22222.00", notes: "kept" },
    });
    return { org, admin, finance };
  }

  it("shows payment events to Management and Finance-capable readers, and hides them from a reader without finance.view.payments", async () => {
    const { admin } = await organisationWithInvoiceAndDealChange();
    const full = await listOrganizationAuditLog(admin);
    expect(full.items.some((e) => e.entity.type === "Invoice")).toBe(true);

    // Same reader with the payments permission removed (a fabricated context, as the masking tests do).
    const limited = { ...admin, permissionKeys: admin.permissionKeys.filter((k) => k !== "finance.view.payments") };
    const page = await listOrganizationAuditLog(limited);
    expect(page.items.some((e) => ["Invoice", "PaymentRecord", "DealPaymentNote"].includes(e.entity.type))).toBe(false);
    expect(JSON.stringify(page)).not.toContain("INV-AUDIT-777");
    expect(JSON.stringify(page)).not.toContain("123456");
    expect(page.total).toBeLessThan(full.total);

    const facets = await getAuditLogFilters(limited);
    expect(facets.entityTypes.map((t) => t.value)).not.toContain("Invoice");
    expect(facets.actions.map((a) => a.value).some((a) => a.startsWith("invoice"))).toBe(false);

    // Asking for the hidden type by name is refused, not answered with an empty page.
    await expect(listOrganizationAuditLog(limited, { entityType: "Invoice" })).rejects.toThrow(ForbiddenError);
    expect(await exportOrganizationAuditLogCsv(limited)).not.toContain("INV-AUDIT-777");
    // The per-record history reader refuses too.
    await expect(auditService.listAuditHistory(limited, "Invoice", "any")).rejects.toThrow(ForbiddenError);
  });

  it("blanks deal values in snapshots for a reader without deals.view.value", async () => {
    const { admin } = await organisationWithInvoiceAndDealChange();
    const limited = { ...admin, permissionKeys: admin.permissionKeys.filter((k) => k !== "deals.view.value") };
    const row = (await listOrganizationAuditLog(limited, { action: "deal.updated" })).items[0]!;
    expect(row.previousValue).toEqual({ value: null, notes: "kept" });
    expect(row.newValue).toEqual({ value: null, notes: "kept" });
    const full = (await listOrganizationAuditLog(admin, { action: "deal.updated" })).items[0]!;
    expect(full.newValue).toEqual({ value: "22222.00", notes: "kept" });
  });
});
