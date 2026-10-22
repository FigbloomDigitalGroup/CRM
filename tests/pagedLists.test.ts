import { describe, expect, it } from "vitest";
import { ForbiddenError } from "../src/auth/errors";
import type { AuthContext } from "../src/auth/context";
import { adminDb } from "../src/db/adminClient";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../src/lib/pagination";
import * as activityService from "../src/services/activityService";
import * as companyService from "../src/services/companyService";
import * as contactService from "../src/services/contactService";
import * as dealService from "../src/services/dealService";
import * as exportService from "../src/services/exportService";
import * as leadService from "../src/services/leadService";
import * as taskService from "../src/services/taskService";
import {
  createTestContext,
  createTestOrganization,
  getLeadStatusId,
  getLostReasonId,
  getPipelineStageId,
} from "./helpers/fixtures";

/**
 * FIG-789: every list service pages with a default and a hard maximum, the
 * page and its total always agree, and nothing crosses an organization or
 * an own/all permission boundary while paging.
 */

async function twoOrgs() {
  const org = await createTestOrganization("Paging");
  const other = await createTestOrganization("Paging Other");
  return {
    org,
    other,
    mgmt: await createTestContext(org.id, "MANAGEMENT", "page.mgmt"),
    otherMgmt: await createTestContext(other.id, "MANAGEMENT", "page.other"),
  };
}

/** Walks every page and returns each page's ids in order. */
async function walk<T extends { id: string }>(
  fetchPage: (page: number) => Promise<{ items: T[]; total: number; pageCount: number }>,
): Promise<string[][]> {
  const first = await fetchPage(1);
  const pages = [first.items.map((i) => i.id)];
  for (let p = 2; p <= first.pageCount; p++) {
    pages.push((await fetchPage(p)).items.map((i) => i.id));
  }
  return pages;
}

function expectCleanPaging(pages: string[][], expectedTotal: number, size: number) {
  const flat = pages.flat();
  expect(flat).toHaveLength(expectedTotal);
  // No row appears twice, none is skipped.
  expect(new Set(flat).size).toBe(expectedTotal);
  pages.slice(0, -1).forEach((p) => expect(p).toHaveLength(size));
  expect(pages[pages.length - 1]!.length).toBeGreaterThan(0);
  expect(pages[pages.length - 1]!.length).toBeLessThanOrEqual(size);
}

describe("leads paging", () => {
  it("splits 5 leads into pages of 2, 2 and 1 with no gaps or repeats, and an empty page past the end", async () => {
    const { org, mgmt } = await twoOrgs();
    const leadStatusId = await getLeadStatusId(org.id);
    for (let i = 0; i < 5; i++) {
      await leadService.createLead(mgmt, { leadStatusId });
    }

    const first = await leadService.listLeadsPage(mgmt, {}, { page: 1, pageSize: 2 });
    expect(first).toMatchObject({ page: 1, pageSize: 2, total: 5, pageCount: 3 });
    expect(first.items).toHaveLength(2);

    const pages = await walk((page) => leadService.listLeadsPage(mgmt, {}, { page, pageSize: 2 }));
    expect(pages.map((p) => p.length)).toEqual([2, 2, 1]);
    expectCleanPaging(pages, 5, 2);

    const beyond = await leadService.listLeadsPage(mgmt, {}, { page: 4, pageSize: 2 });
    expect(beyond.items).toEqual([]);
    expect(beyond.total).toBe(5);
  });

  it("uses the default page size when none is given and clamps an oversized request to the maximum", async () => {
    const { org, mgmt } = await twoOrgs();
    const leadStatusId = await getLeadStatusId(org.id);
    for (let i = 0; i < DEFAULT_PAGE_SIZE + 3; i++) {
      await leadService.createLead(mgmt, { leadStatusId });
    }

    const byDefault = await leadService.listLeadsPage(mgmt);
    expect(byDefault.pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(byDefault.items).toHaveLength(DEFAULT_PAGE_SIZE);
    expect(byDefault.total).toBe(DEFAULT_PAGE_SIZE + 3);
    expect(byDefault.pageCount).toBe(2);

    const huge = await leadService.listLeadsPage(mgmt, {}, { pageSize: 1_000_000 });
    expect(huge.pageSize).toBe(MAX_PAGE_SIZE);
  });

  it("keeps the filter across pages: the total and every page reflect only the matching rows", async () => {
    const { org, mgmt } = await twoOrgs();
    const leadStatusId = await getLeadStatusId(org.id);
    const { company: keep } = await companyService.createCompany(mgmt, { name: "KeepMe Ltd" });
    const { company: drop } = await companyService.createCompany(mgmt, { name: "DropMe Ltd" });
    for (let i = 0; i < 5; i++) {
      await leadService.createLead(mgmt, { leadStatusId, companyId: keep.id });
    }
    for (let i = 0; i < 3; i++) {
      await leadService.createLead(mgmt, { leadStatusId, companyId: drop.id });
    }

    const filtered = { query: "KeepMe" };
    const pages = await walk((page) =>
      leadService.listLeadsPage(mgmt, filtered, { page, pageSize: 2 }),
    );
    expectCleanPaging(pages, 5, 2);
    expect(await leadService.countLeads(mgmt, filtered)).toBe(5);
  });

  it("never returns another organization's leads, in the page or in the total", async () => {
    const { org, other, mgmt, otherMgmt } = await twoOrgs();
    const mine = await getLeadStatusId(org.id);
    const theirs = await getLeadStatusId(other.id);
    for (let i = 0; i < 3; i++) await leadService.createLead(mgmt, { leadStatusId: mine });
    for (let i = 0; i < 4; i++) {
      await leadService.createLead(otherMgmt, { leadStatusId: theirs });
    }

    const page = await leadService.listLeadsPage(mgmt, {}, { pageSize: 100 });
    expect(page.total).toBe(3);
    expect(page.items.every((l) => l.organizationId === org.id)).toBe(true);
    expect(await leadService.countLeads(mgmt)).toBe(3);
    expect(await leadService.countLeads(otherMgmt)).toBe(4);
  });

  it("Sales (own only) pages and counts just their own leads, even with a forged owner filter", async () => {
    const { org } = await twoOrgs();
    const leadStatusId = await getLeadStatusId(org.id);
    const alice = await createTestContext(org.id, "SALES", "page.alice");
    const bob = await createTestContext(org.id, "SALES", "page.bob");
    for (let i = 0; i < 3; i++) await leadService.createLead(alice, { leadStatusId });
    for (let i = 0; i < 2; i++) await leadService.createLead(bob, { leadStatusId });

    const aliceView = await leadService.listLeadsPage(alice, {}, { pageSize: 2 });
    expect(aliceView.total).toBe(3);
    expect(aliceView.pageCount).toBe(2);

    const forged = await leadService.listLeadsPage(
      alice,
      { ownerMembershipId: bob.membershipId },
      { pageSize: 100 },
    );
    expect(forged.total).toBe(3);
    expect(forged.items.every((l) => l.ownerMembershipId === alice.membershipId)).toBe(true);
    expect(await leadService.countLeads(alice, { ownerMembershipId: bob.membershipId })).toBe(3);
  });

  it("refuses a role with no lead access instead of returning an empty page", async () => {
    const { org } = await twoOrgs();
    const finance = await createTestContext(org.id, "FINANCE", "page.fin");
    await expect(leadService.listLeadsPage(finance)).rejects.toThrow(ForbiddenError);
    await expect(leadService.countLeads(finance)).rejects.toThrow(ForbiddenError);
  });
});

describe("contacts and companies paging", () => {
  it("pages contacts with a stable order and a matching total, scoped to the organization", async () => {
    const { mgmt, otherMgmt } = await twoOrgs();
    for (let i = 0; i < 5; i++) await contactService.createContact(mgmt, { firstName: `C${i}` });
    await contactService.createContact(otherMgmt, { firstName: "Elsewhere" });

    const pages = await walk((page) =>
      contactService.listContactsPage(mgmt, {}, { page, pageSize: 2 }),
    );
    expect(pages.map((p) => p.length)).toEqual([2, 2, 1]);
    expectCleanPaging(pages, 5, 2);
    expect(await contactService.countContacts(mgmt)).toBe(5);
    expect(await contactService.countContacts(otherMgmt)).toBe(1);
  });

  it("pages companies and keeps a search filter across pages", async () => {
    const { mgmt, otherMgmt } = await twoOrgs();
    for (let i = 0; i < 5; i++) await companyService.createCompany(mgmt, { name: `Acme ${i}` });
    for (let i = 0; i < 2; i++) await companyService.createCompany(mgmt, { name: `Other ${i}` });
    await companyService.createCompany(otherMgmt, { name: "Acme Elsewhere" });

    const pages = await walk((page) =>
      companyService.listCompaniesPage(mgmt, { query: "Acme" }, { page, pageSize: 2 }),
    );
    expectCleanPaging(pages, 5, 2);
    expect(await companyService.countCompanies(mgmt)).toBe(7);
  });

  it("refuses contact and company paging without the view permission", async () => {
    const { org } = await twoOrgs();
    const technical = await createTestContext(org.id, "RESTRICTED_TECHNICAL", "page.tech");
    await expect(contactService.listContactsPage(technical)).rejects.toThrow(ForbiddenError);
    await expect(companyService.listCompaniesPage(technical)).rejects.toThrow(ForbiddenError);
    await expect(contactService.countContacts(technical)).rejects.toThrow(ForbiddenError);
  });
});

describe("deals paging and the dashboard summary", () => {
  async function seedDeals(ctx: AuthContext, count: number, value?: number) {
    const { company } = await companyService.createCompany(ctx, {
      name: `Deal Co ${Math.random()}`,
    });
    const pipelineStageId = await getPipelineStageId(ctx.organizationId);
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const deal = await dealService.createDeal(ctx, {
        companyId: company.id,
        pipelineStageId,
        value,
      });
      ids.push(deal.id);
    }
    return ids;
  }

  it("pages deals with a matching total and without leaking another organization's deals", async () => {
    const { mgmt, otherMgmt } = await twoOrgs();
    await seedDeals(mgmt, 5);
    await seedDeals(otherMgmt, 3);

    const pages = await walk((page) =>
      dealService.listDealsPage(mgmt, {}, { page, pageSize: 2 }),
    );
    expect(pages.map((p) => p.length)).toEqual([2, 2, 1]);
    expectCleanPaging(pages, 5, 2);
    expect(await dealService.countDeals(mgmt)).toBe(5);
  });

  it("masks values on a page exactly as the unpaged list does", async () => {
    const { org, mgmt } = await twoOrgs();
    await seedDeals(mgmt, 3, 1000);
    const delivery = await createTestContext(org.id, "DELIVERY", "page.delivery");

    const page = await dealService.listDealsPage(delivery, {}, { pageSize: 10 });
    expect(page.total).toBe(3);
    expect(page.items.every((d) => d.valueMasked && d.value === null)).toBe(true);
  });

  it("summarizes deals with aggregates: counts by outcome and the open pipeline value", async () => {
    const { mgmt } = await twoOrgs();
    const openIds = await seedDeals(mgmt, 3, 1000);
    const wonIds = await seedDeals(mgmt, 1, 500);
    // Outcome only changes through a stage move (the database enforces it).
    await dealService.updateDeal(mgmt, wonIds[0]!, {
      pipelineStageId: await getPipelineStageId(mgmt.organizationId, "CLOSED_WON"),
    });
    await dealService.updateDeal(mgmt, openIds[0]!, {
      pipelineStageId: await getPipelineStageId(mgmt.organizationId, "CLOSED_LOST"),
      lostReasonId: await getLostReasonId(mgmt.organizationId),
    });

    const summary = await dealService.getDealSummary(mgmt);
    expect(summary).toMatchObject({ total: 4, open: 2, won: 1, lost: 1 });
    expect(summary.openValue).toEqual({ currency: "KES", amount: 2000 });
  });

  it("omits the open-pipeline total when a value is missing or the viewer cannot see every value", async () => {
    const { org, mgmt } = await twoOrgs();
    await seedDeals(mgmt, 2, 1000);
    await seedDeals(mgmt, 1); // open deal with no value

    expect((await dealService.getDealSummary(mgmt)).openValue).toBeNull();

    const { org: org2, mgmt: mgmt2 } = await twoOrgs();
    await seedDeals(mgmt2, 2, 1000);
    expect((await dealService.getDealSummary(mgmt2)).openValue).toEqual({
      currency: "KES",
      amount: 2000,
    });
    // Delivery sees every deal but not their values, so no total.
    const delivery = await createTestContext(org2.id, "DELIVERY", "page.sumdel");
    const masked = await dealService.getDealSummary(delivery);
    expect(masked.open).toBe(2);
    expect(masked.openValue).toBeNull();
    // Finance can see values.
    const finance = await createTestContext(org2.id, "FINANCE", "page.sumfin");
    expect((await dealService.getDealSummary(finance)).openValue).toEqual({
      currency: "KES",
      amount: 2000,
    });
    void org;
  });

  it("scopes the summary to the owner for Sales, and shows them the value of their own deals", async () => {
    const { org, mgmt } = await twoOrgs();
    const sales = await createTestContext(org.id, "SALES", "page.sumsales");
    await seedDeals(mgmt, 2, 1000);
    await seedDeals(sales, 1, 250);

    const summary = await dealService.getDealSummary(sales);
    expect(summary).toMatchObject({ total: 1, open: 1, won: 0, lost: 0 });
    expect(summary.openValue).toEqual({ currency: "KES", amount: 250 });
  });
});

describe("tasks paging", () => {
  it("pages tasks, counts overdue with COUNT, and respects own-only scope", async () => {
    const { org, mgmt } = await twoOrgs();
    const sales = await createTestContext(org.id, "SALES", "page.tasksales");
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    for (let i = 0; i < 4; i++) {
      await taskService.createTask(mgmt, { title: `Mgmt ${i}`, dueAt: yesterday });
    }
    for (let i = 0; i < 3; i++) await taskService.createTask(sales, { title: `Sales ${i}` });

    const pages = await walk((page) =>
      taskService.listTasksPage(mgmt, {}, { page, pageSize: 3 }),
    );
    expect(pages.map((p) => p.length)).toEqual([3, 3, 1]);
    expectCleanPaging(pages, 7, 3);

    expect(await taskService.countTasks(mgmt, { overdueOnly: true })).toBe(4);
    expect(await taskService.countTasks(sales)).toBe(3);
    const own = await taskService.listTasksPage(sales, {}, { pageSize: 2 });
    expect(own.total).toBe(3);
    expect(own.items.every((t) => t.assigneeMembershipId === sales.membershipId)).toBe(true);
  });

  it("lists only open tasks that are not yet overdue as 'upcoming', capped by take", async () => {
    const { mgmt } = await twoOrgs();
    const day = 24 * 3600 * 1000;
    await taskService.createTask(mgmt, { title: "overdue", dueAt: new Date(Date.now() - day).toISOString() });
    await taskService.createTask(mgmt, { title: "soon", dueAt: new Date(Date.now() + day).toISOString() });
    await taskService.createTask(mgmt, { title: "later", dueAt: new Date(Date.now() + 3 * day).toISOString() });
    await taskService.createTask(mgmt, { title: "no date" });

    const upcoming = await taskService.listTasks(mgmt, { upcomingOnly: true, take: 2 });
    expect(upcoming.map((t) => t.title)).toEqual(["soon", "later"]);
    expect(await taskService.countTasks(mgmt, { upcomingOnly: true })).toBe(3);
  });
});

describe("activities paging", () => {
  it("pages a lead's activity log oldest-first, scoped to the lead", async () => {
    const { org, mgmt } = await twoOrgs();
    const leadStatusId = await getLeadStatusId(org.id);
    const { lead } = await leadService.createLead(mgmt, { leadStatusId });
    const { lead: otherLead } = await leadService.createLead(mgmt, { leadStatusId });
    for (let i = 0; i < 5; i++) {
      await activityService.createActivity(mgmt, {
        type: "NOTE",
        subject: `n${i}`,
        leadId: lead.id,
        occurredAt: new Date(2026, 0, 1 + i),
      });
    }
    await activityService.createActivity(mgmt, { type: "NOTE", leadId: otherLead.id });

    const first = await activityService.listActivitiesPage(mgmt, { leadId: lead.id }, { pageSize: 2 });
    expect(first).toMatchObject({ total: 5, pageCount: 3 });
    expect(first.items.map((a) => a.subject)).toEqual(["n0", "n1"]);

    const last = await activityService.listActivitiesPage(mgmt, { leadId: lead.id }, { page: 3, pageSize: 2 });
    expect(last.items.map((a) => a.subject)).toEqual(["n4"]);
  });

  it("pages a company's cross-record timeline", async () => {
    const { org, mgmt } = await twoOrgs();
    const leadStatusId = await getLeadStatusId(org.id);
    const { company } = await companyService.createCompany(mgmt, { name: "Timeline Co" });
    const { lead } = await leadService.createLead(mgmt, { leadStatusId, companyId: company.id });
    await activityService.createActivity(mgmt, { type: "CALL", companyId: company.id });
    for (let i = 0; i < 3; i++) {
      await activityService.createActivity(mgmt, { type: "NOTE", leadId: lead.id });
    }

    const page1 = await activityService.listTimelineActivitiesPage(mgmt, { companyId: company.id }, { pageSize: 3 });
    const page2 = await activityService.listTimelineActivitiesPage(mgmt, { companyId: company.id }, { page: 2, pageSize: 3 });
    expect(page1.total).toBe(4);
    expect(page1.items).toHaveLength(3);
    expect(page2.items).toHaveLength(1);
    expect(new Set([...page1.items, ...page2.items].map((a) => a.id)).size).toBe(4);
  });
});

describe("CSV export covers the whole filtered set, not one page", () => {
  it("exports every matching lead (more than a default page), streamed, and audits the full count", async () => {
    const { org, mgmt } = await twoOrgs();
    const leadStatusId = await getLeadStatusId(org.id);
    const total = DEFAULT_PAGE_SIZE + 7;
    const { company: match } = await companyService.createCompany(mgmt, { name: "ExportMatch Ltd" });
    const { company: other } = await companyService.createCompany(mgmt, { name: "Unrelated Ltd" });
    for (let i = 0; i < total; i++) {
      await leadService.createLead(mgmt, { leadStatusId, companyId: match.id });
    }
    await leadService.createLead(mgmt, { leadStatusId, companyId: other.id });

    const csv = await exportService.exportLeadsCsv(mgmt, { query: "ExportMatch" });
    const rows: Record<string, unknown>[] = [];
    for await (const row of csv.rows) rows.push(row);

    expect(rows).toHaveLength(total);
    expect(new Set(rows.map((r) => r.id)).size).toBe(total);

    const audit = await adminDb.auditEvent.findFirstOrThrow({
      where: { organizationId: org.id, action: "leads.exported" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit.metadata).toMatchObject({ count: total });
  });

  it("exports every company and contact beyond one page, and never another organization's rows", async () => {
    const { mgmt, otherMgmt } = await twoOrgs();
    const total = DEFAULT_PAGE_SIZE + 2;
    for (let i = 0; i < total; i++) {
      await companyService.createCompany(mgmt, { name: `Export Co ${i}` });
      await contactService.createContact(mgmt, { firstName: `Export${i}` });
    }
    await companyService.createCompany(otherMgmt, { name: "Theirs" });

    const companies: unknown[] = [];
    for await (const row of (await exportService.exportCompaniesCsv(mgmt)).rows) companies.push(row);
    const contacts: unknown[] = [];
    for await (const row of (await exportService.exportContactsCsv(mgmt)).rows) contacts.push(row);
    expect(companies).toHaveLength(total);
    expect(contacts).toHaveLength(total);
  });

  it("exports every deal beyond one page with values still masked for a role that cannot see them", async () => {
    const { org, mgmt } = await twoOrgs();
    const { company } = await companyService.createCompany(mgmt, { name: "Deal Export Co" });
    const pipelineStageId = await getPipelineStageId(org.id);
    const total = DEFAULT_PAGE_SIZE + 3;
    for (let i = 0; i < total; i++) {
      await dealService.createDeal(mgmt, { companyId: company.id, pipelineStageId, value: 100 });
    }
    const delivery = await createTestContext(org.id, "DELIVERY", "page.exportdel");
    // Delivery has no export permission, so the export is refused outright.
    await expect(exportService.exportDealsCsv(delivery)).rejects.toThrow(ForbiddenError);

    const rows: Record<string, unknown>[] = [];
    for await (const row of (await exportService.exportDealsCsv(mgmt)).rows) rows.push(row);
    expect(rows).toHaveLength(total);
  });
});
