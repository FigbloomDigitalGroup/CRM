import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { ForbiddenError, RateLimitedError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { ROLE_PERMISSIONS } from "../prisma/seedData";
import * as exportService from "../src/services/exportService";
import * as importService from "../src/services/importService";
import { createCompany } from "../src/services/companyService";
import { createDeal, updateDeal } from "../src/services/dealService";
import { createLead } from "../src/services/leadService";
import {
  createTestContext,
  createTestMembership,
  createTestOrganization,
  getLeadStatusId,
  getPipelineStageId,
} from "./helpers/fixtures";

/** P2-26 (FIG-1680): CSV import and export for every role, through the permission model. */

async function collect(csv: exportService.CsvExport) {
  const rows: Record<string, unknown>[] = [];
  for await (const row of csv.rows) rows.push(row);
  return rows;
}
const stream = (text: string) => Readable.from([text]);

afterEach(() => {
  delete process.env.EXPORT_MAX_ROWS;
  delete process.env.EXPORT_MAX_PER_USER_PER_HOUR;
  delete process.env.EXPORT_MAX_PER_ORG_PER_HOUR;
});

describe("P2-26: the permission model", () => {
  it("gives the roles that work leads the leads import and export keys, in the seed and in the database", async () => {
    for (const role of ["MANAGEMENT", "SALES"]) {
      expect(ROLE_PERMISSIONS[role], role).toEqual(expect.arrayContaining(["leads.export", "leads.import"]));
      const row = await adminDb.role.findUniqueOrThrow({ where: { key: role }, include: { rolePermissions: { include: { permission: true } } } });
      const keys = row.rolePermissions.map((rp) => rp.permission.key);
      expect(keys, role).toEqual(expect.arrayContaining(["leads.export", "leads.import"]));
    }
  });

  it("gives Delivery and Finance the contacts, companies and deals exports, and no lead keys (they cannot see leads)", async () => {
    for (const role of ["DELIVERY", "FINANCE"]) {
      expect(ROLE_PERMISSIONS[role], role).toEqual(expect.arrayContaining(["contacts.export", "companies.export", "deals.export"]));
      expect(ROLE_PERMISSIONS[role], role).not.toContain("leads.export");
      expect(ROLE_PERMISSIONS[role], role).not.toContain("leads.import");
      const row = await adminDb.role.findUniqueOrThrow({ where: { key: role }, include: { rolePermissions: { include: { permission: true } } } });
      const keys = row.rolePermissions.map((rp) => rp.permission.key);
      expect(keys, role).toEqual(expect.arrayContaining(["contacts.export", "companies.export", "deals.export"]));
    }
    expect(ROLE_PERMISSIONS.RESTRICTED_TECHNICAL).not.toContain("leads.export");
  });

  it("gives Sales contacts and companies import and export, and deals export", () => {
    expect(ROLE_PERMISSIONS.SALES).toEqual(
      expect.arrayContaining(["contacts.export", "contacts.import", "companies.export", "companies.import", "deals.export"]),
    );
  });
});

describe("P2-26: exports are scoped to what the role sees", () => {
  it("Sales exports its own leads and the shared pool, never another person's lead", async () => {
    const org = await createTestOrganization();
    const mgmt = await createTestContext(org.id, "MANAGEMENT", "mgmt");
    const sales = await createTestContext(org.id, "SALES", "sales");
    const other = await createTestContext(org.id, "SALES", "other");
    const leadStatusId = await getLeadStatusId(org.id);
    const mine = (await createLead(sales, { leadStatusId })).lead;
    const theirs = (await createLead(other, { leadStatusId })).lead;
    const pool = (await createLead(mgmt, { leadStatusId })).lead;
    await adminDb.lead.update({ where: { organizationId_id: { organizationId: org.id, id: pool.id } }, data: { ownerMembershipId: null } });

    const rows = await collect(await exportService.exportLeadsCsv(sales));
    const ids = rows.map((r) => r.id);
    expect(ids.sort()).toEqual([mine.id, pool.id].sort());
    expect(ids).not.toContain(theirs.id);

    const all = await collect(await exportService.exportLeadsCsv(mgmt));
    expect(all).toHaveLength(3);
  });

  it("a role that cannot see leads gets an explained refusal, not an empty or full file", async () => {
    const org = await createTestOrganization();
    for (const role of ["DELIVERY", "FINANCE", "RESTRICTED_TECHNICAL"]) {
      const ctx = await createTestContext(org.id, role, `r-${role.toLowerCase()}`);
      await expect(exportService.exportLeadsCsv(ctx), role).rejects.toThrow(ForbiddenError);
    }
  });

  it("does not leak another organisation's rows", async () => {
    const orgA = await createTestOrganization();
    const orgB = await createTestOrganization();
    const aliceA = await createTestContext(orgA.id, "SALES", "alice");
    const bobB = await createTestContext(orgB.id, "SALES", "bob");
    const a = (await createLead(aliceA, { leadStatusId: await getLeadStatusId(orgA.id) })).lead;
    const b = (await createLead(bobB, { leadStatusId: await getLeadStatusId(orgB.id) })).lead;

    const rows = await collect(await exportService.exportLeadsCsv(bobB));
    expect(rows.map((r) => r.id)).toEqual([b.id]);
    expect(rows.map((r) => r.id)).not.toContain(a.id);
  });
});

describe("P2-26: exports mask by role (rule 7)", () => {
  async function wonDeal() {
    const org = await createTestOrganization();
    const mgmt = await createTestContext(org.id, "MANAGEMENT", "mgmt");
    const { company } = await createCompany(mgmt, { name: "Won Co" });
    const deal = await createDeal(mgmt, { companyId: company.id, pipelineStageId: await getPipelineStageId(org.id), value: "7777" });
    await updateDeal(mgmt, deal.id, { pipelineStageId: await getPipelineStageId(org.id, "CLOSED_WON") });
    return org;
  }

  it("Delivery's deal export never carries the value; Finance's does; no payment column exists for anyone", async () => {
    const org = await wonDeal();
    const delivery = await createTestContext(org.id, "DELIVERY", "delivery");
    const finance = await createTestContext(org.id, "FINANCE", "finance");

    const d = await exportService.exportDealsCsv(delivery);
    const dRows = await collect(d);
    expect(dRows).toHaveLength(1);
    expect(dRows[0]!.valueMasked).toBe(true);
    expect(dRows[0]!.value).toBe("");
    expect(JSON.stringify(dRows)).not.toContain("7777");

    const f = await exportService.exportDealsCsv(finance);
    const fRows = await collect(f);
    expect(fRows[0]!.value).toBe("7777");
    for (const columns of [d.columns, f.columns]) {
      expect(columns.join(",")).not.toMatch(/payment|margin|cost|invoice/i);
    }
  });

  it("Sales does not see another person's deal value or the deal itself", async () => {
    const org = await createTestOrganization();
    const mgmt = await createTestContext(org.id, "MANAGEMENT", "mgmt");
    const sales = await createTestContext(org.id, "SALES", "sales");
    const { company } = await createCompany(mgmt, { name: "Hidden Co" });
    await createDeal(mgmt, { companyId: company.id, pipelineStageId: await getPipelineStageId(org.id), value: "9191" });

    const rows = await collect(await exportService.exportDealsCsv(sales));
    expect(JSON.stringify(rows)).not.toContain("9191");
    expect(rows).toHaveLength(0);
  });

  it("a role with no deal access cannot export deals", async () => {
    const org = await createTestOrganization();
    const tech = await createTestContext(org.id, "RESTRICTED_TECHNICAL", "tech");
    await expect(exportService.exportDealsCsv(tech)).rejects.toThrow(ForbiddenError);
  });
});

describe("P2-26: imports are scoped", () => {
  it("Sales imports leads that belong to the importer", async () => {
    const org = await createTestOrganization();
    const sales = await createTestContext(org.id, "SALES", "sales");
    const status = await adminDb.leadStatus.findUniqueOrThrow({ where: { id: await getLeadStatusId(org.id) } });

    const summary = await importService.importLeads(sales, {
      fileStream: stream(`Status,Notes\n${status.name},imported\n`),
      mapping: { leadStatus: "Status", notes: "Notes" },
      duplicateStrategy: "skip",
    });
    expect(summary.created).toBe(1);
    const lead = await adminDb.lead.findFirstOrThrow({ where: { organizationId: org.id } });
    expect(lead.ownerMembershipId).toBe(sales.membershipId);
  });

  it("Sales cannot hand an imported lead to someone else, but Management can", async () => {
    const org = await createTestOrganization();
    const sales = await createTestContext(org.id, "SALES", "sales");
    const mgmt = await createTestContext(org.id, "MANAGEMENT", "mgmt");
    const { user: colleague, membership } = await createTestMembership(org.id, "SALES", "colleague");
    const status = await adminDb.leadStatus.findUniqueOrThrow({ where: { id: await getLeadStatusId(org.id) } });
    const csv = `Status,Owner\n${status.name},${colleague.email}\n`;
    const mapping = { leadStatus: "Status", ownerEmail: "Owner" };

    const denied = await importService.importLeads(sales, { fileStream: stream(csv), mapping, duplicateStrategy: "skip" });
    expect(denied.created).toBe(0);
    expect(denied.failed).toBe(1);
    expect(denied.errors[0]!.reason).toMatch(/belong to you/);

    const allowed = await importService.importLeads(mgmt, { fileStream: stream(csv), mapping, duplicateStrategy: "skip" });
    expect(allowed.created).toBe(1);
    const lead = await adminDb.lead.findFirstOrThrow({ where: { organizationId: org.id } });
    expect(lead.ownerMembershipId).toBe(membership.id);
  });

  it("a role that cannot work leads cannot import them", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "DELIVERY", "delivery");
    await expect(
      importService.importLeads(ctx, { fileStream: stream("Status\nNew\n"), mapping: { leadStatus: "Status" }, duplicateStrategy: "skip" }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("Sales imports companies and contacts as their own, and cannot name another owner", async () => {
    const org = await createTestOrganization();
    const sales = await createTestContext(org.id, "SALES", "sales");
    const { user: colleague } = await createTestMembership(org.id, "SALES", "colleague");
    const own = await importService.importCompanies(sales, {
      fileStream: stream("Name\nOwn Co\n"),
      mapping: { name: "Name" },
      duplicateStrategy: "skip",
    });
    expect(own.created).toBe(1);
    const company = await adminDb.company.findFirstOrThrow({ where: { organizationId: org.id } });
    expect(company.ownerMembershipId).toBe(sales.membershipId);

    const other = await importService.importContacts(sales, {
      fileStream: stream(`First,Owner\nAda,${colleague.email}\n`),
      mapping: { firstName: "First", ownerEmail: "Owner" },
      duplicateStrategy: "skip",
    });
    expect(other.created).toBe(0);
    expect(other.failed).toBe(1);
  });
});

describe("P2-26: safeguards", () => {
  it("writes an audit event with the count and the filters, and no row data", async () => {
    const org = await createTestOrganization();
    const sales = await createTestContext(org.id, "SALES", "sales");
    const lead = (await createLead(sales, { leadStatusId: await getLeadStatusId(org.id) })).lead;

    await collect(await exportService.exportLeadsCsv(sales, { ownerMembershipId: sales.membershipId }));
    const events = await adminDb.auditEvent.findMany({ where: { organizationId: org.id, action: "leads.exported" } });
    expect(events).toHaveLength(1);
    expect(events[0]!.actorMembershipId).toBe(sales.membershipId);
    expect(events[0]!.metadata).toMatchObject({ count: 1, filters: { ownerMembershipId: sales.membershipId } });
    expect(JSON.stringify(events[0]!.metadata)).not.toContain(lead.id);
  });

  it("limits exports per person per hour and says so", async () => {
    process.env.EXPORT_MAX_PER_USER_PER_HOUR = "2";
    const org = await createTestOrganization();
    const sales = await createTestContext(org.id, "SALES", "sales");
    const other = await createTestContext(org.id, "SALES", "other");
    await exportService.exportLeadsCsv(sales);
    await exportService.exportLeadsCsv(sales);
    await expect(exportService.exportLeadsCsv(sales)).rejects.toThrow(RateLimitedError);
    // Someone else in the same organisation is not blocked by it.
    await expect(exportService.exportLeadsCsv(other)).resolves.toBeDefined();
  });

  it("limits exports per organisation per hour", async () => {
    process.env.EXPORT_MAX_PER_ORG_PER_HOUR = "2";
    const org = await createTestOrganization();
    const a = await createTestContext(org.id, "SALES", "a");
    const b = await createTestContext(org.id, "SALES", "b");
    await exportService.exportLeadsCsv(a);
    await exportService.exportLeadsCsv(b);
    await expect(exportService.exportLeadsCsv(a)).rejects.toThrow(RateLimitedError);
  });

  it("refuses a file above the row cap with a clear message", async () => {
    process.env.EXPORT_MAX_ROWS = "1";
    const org = await createTestOrganization();
    const sales = await createTestContext(org.id, "SALES", "sales");
    const leadStatusId = await getLeadStatusId(org.id);
    await createLead(sales, { leadStatusId }, { skipDuplicateCheck: true });
    await createLead(sales, { leadStatusId }, { skipDuplicateCheck: true });
    await expect(exportService.exportLeadsCsv(sales)).rejects.toThrow(ValidationError);
    await expect(exportService.exportLeadsCsv(sales)).rejects.toThrow(/at most 1/);
  });
});
