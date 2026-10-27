import { describe, expect, it } from "vitest";
import { ForbiddenError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { companyFiltersForTab, contactFiltersForExport, listCompanyDirectory, listContactDirectory } from "../src/services/directoryService";
import { exportCompaniesCsv, exportContactsCsv } from "../src/services/exportService";
import { changeTags, createTag } from "../src/services/tagService";
import { createTestContext, createTestOrganization, getServiceId } from "./helpers/fixtures";
import { createCompanyRow, createWonDeal, day } from "./helpers/stage3";

async function setup() {
  const org = await createTestOrganization("Directories");
  const management = await createTestContext(org.id, "MANAGEMENT");
  const sales = await createTestContext(org.id, "SALES");
  const otherSales = await createTestContext(org.id, "SALES", "other.sales");
  const delivery = await createTestContext(org.id, "DELIVERY");
  const technical = await createTestContext(org.id, "RESTRICTED_TECHNICAL");
  return { org, management, sales, otherSales, delivery, technical };
}

async function rowsOf(source: { columns: string[]; rows: AsyncIterable<Record<string, unknown>> }) {
  const out: Record<string, unknown>[] = [];
  for await (const r of source.rows) out.push(r);
  return out;
}

const names = async (ctx: Awaited<ReturnType<typeof setup>>["management"], filters: Parameters<typeof listCompanyDirectory>[1]) =>
  (await listCompanyDirectory(ctx, filters, { pageSize: 100 })).items.map((c) => c.name).sort();

async function companyFixture() {
  const f = await setup();
  const { org, sales, otherSales, management } = f;
  const crm = await getServiceId(org.id, "CRM");
  const cctv = await getServiceId(org.id, "CCTV");
  const active = await createCompanyRow(org.id, { name: "Active Co", lifecycleKey: "ACTIVE_CUSTOMER", ownerMembershipId: sales.membershipId });
  const dormant = await createCompanyRow(org.id, { name: "Dormant Co", lifecycleKey: "DORMANT_CUSTOMER", ownerMembershipId: sales.membershipId });
  const prospect = await createCompanyRow(org.id, { name: "Prospect Co", lifecycleKey: "PROSPECT", ownerMembershipId: otherSales.membershipId });
  const archived = await createCompanyRow(org.id, { name: "Archived Co", lifecycleKey: "DORMANT_CUSTOMER", ownerMembershipId: sales.membershipId });
  await adminDb.company.update({ where: { id: archived.id }, data: { archivedAt: new Date(), archiveReason: "closed" } });
  const bare = await createCompanyRow(org.id, { name: "Bare Co" });
  // Services: Active Co runs CRM through a company service; Dormant Co has a recurring CCTV; Prospect Co won a CRM deal.
  await adminDb.companyService.create({ data: { organizationId: org.id, companyId: active.id, serviceId: crm, status: "ACTIVE" } });
  await adminDb.companyService.create({ data: { organizationId: org.id, companyId: bare.id, serviceId: crm, status: "CANCELLED" } });
  await adminDb.recurringService.create({ data: { organizationId: org.id, companyId: dormant.id, serviceId: cctv, startsOn: day("2026-01-01"), renewsOn: day("2027-01-01") } });
  await createWonDeal(org.id, sales, { companyId: prospect.id, serviceKey: "CRM", value: 8123456 });
  const vip = await createTag(management, { name: "vip" });
  await changeTags(management, "company", active.id, { addTagIds: [vip.id] });
  await changeTags(management, "company", dormant.id, { addTagIds: [vip.id] });
  return { ...f, crm, cctv, active, dormant, prospect, archived, bare, vip };
}

describe("company lists (FIG-1056)", () => {
  it("shows All without archived, Dormant as a subset, and Archived, with counts that match each tab", async () => {
    const f = await companyFixture();
    const all = await listCompanyDirectory(f.management, {}, { pageSize: 100 });
    expect(all.items.map((c) => c.name).sort()).toEqual(["Active Co", "Bare Co", "Dormant Co", "Prospect Co"]);
    expect(all.tabCounts).toEqual({ ALL: 4, DORMANT: 1, ARCHIVED: 1 });
    expect(all.total).toBe(4);
    expect(await names(f.management, { tab: "DORMANT" })).toEqual(["Dormant Co"]);
    expect(await names(f.management, { tab: "ARCHIVED" })).toEqual(["Archived Co"]);
    for (const tab of ["ALL", "DORMANT", "ARCHIVED"] as const) {
      const page = await listCompanyDirectory(f.management, { tab }, { pageSize: 100 });
      expect(page.total).toBe(all.tabCounts[tab]);
      expect(page.items).toHaveLength(page.total);
      expect(page.tab).toBe(tab);
    }
    expect(all.items.find((c) => c.name === "Active Co")).toMatchObject({ lifecycleState: { key: "ACTIVE_CUSTOMER" } });
  });

  it("combines lifecycle, service, owner, tag and search filters, and counts follow them", async () => {
    const f = await companyFixture();
    expect(await names(f.management, { lifecycle: "ACTIVE_CUSTOMER" })).toEqual(["Active Co"]);
    const stateId = (await adminDb.customerLifecycleState.findFirstOrThrow({ where: { organizationId: f.org.id, key: "PROSPECT" } })).id;
    expect(await names(f.management, { lifecycle: stateId })).toEqual(["Prospect Co"]);
    expect(await names(f.management, { serviceId: f.crm })).toEqual(["Active Co", "Prospect Co"]); // a company service and a won deal; a cancelled one does not count
    expect(await names(f.management, { serviceId: f.cctv })).toEqual(["Dormant Co"]); // a recurring service
    expect(await names(f.management, { ownerMembershipId: f.sales.membershipId })).toEqual(["Active Co", "Dormant Co"]);
    expect(await names(f.management, { tagIds: [f.vip.id] })).toEqual(["Active Co", "Dormant Co"]);
    expect(await names(f.management, { tagIds: [f.vip.id], ownerMembershipId: f.sales.membershipId, serviceId: f.cctv })).toEqual(["Dormant Co"]);
    expect(await names(f.management, { query: "prospect" })).toEqual(["Prospect Co"]);
    expect(await names(f.management, { tab: "DORMANT", tagIds: [f.vip.id] })).toEqual(["Dormant Co"]);
    expect(await names(f.management, { tab: "DORMANT", lifecycle: "ACTIVE_CUSTOMER" })).toEqual([]);
    const tagged = await listCompanyDirectory(f.management, { tagIds: [f.vip.id] }, {});
    expect(tagged.tabCounts).toEqual({ ALL: 2, DORMANT: 1, ARCHIVED: 0 });
    const bySales = await listCompanyDirectory(f.management, { ownerMembershipId: f.sales.membershipId }, {});
    expect(bySales.tabCounts).toEqual({ ALL: 2, DORMANT: 1, ARCHIVED: 1 });
    expect(await names(f.management, { serviceId: "00000000-0000-0000-0000-000000000000" })).toEqual([]);
  });

  it("pages, and refuses a tab or lifecycle it does not know", async () => {
    const f = await companyFixture();
    const first = await listCompanyDirectory(f.management, {}, { pageSize: 3 });
    const second = await listCompanyDirectory(f.management, {}, { pageSize: 3, cursor: first.nextCursor! });
    expect(first.items).toHaveLength(3);
    expect(second.items).toHaveLength(1);
    expect(new Set([...first.items, ...second.items].map((c) => c.id)).size).toBe(4);
    await expect(listCompanyDirectory(f.management, { tab: "SPAM" })).rejects.toBeInstanceOf(ValidationError);
    await expect(listCompanyDirectory(f.management, { lifecycle: "NOT_A_STATE" })).rejects.toBeInstanceOf(ValidationError);
    await expect(companyFiltersForTab(f.management, { tab: "SPAM" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("is for roles that can view companies, and the export of a tab carries only that tab, with no deal value in it", async () => {
    const f = await companyFixture();
    await expect(listCompanyDirectory(f.technical, {})).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listCompanyDirectory(f.delivery, {})).total).toBe(4);
    await expect(exportCompaniesCsv(f.delivery, {})).rejects.toBeInstanceOf(ForbiddenError); // no companies.export

    const dormantExport = await rowsOf(await exportCompaniesCsv(f.management, await companyFiltersForTab(f.management, { tab: "DORMANT" })));
    expect(dormantExport.map((r) => r.name)).toEqual(["Dormant Co"]);
    const archivedExport = await rowsOf(await exportCompaniesCsv(f.management, await companyFiltersForTab(f.management, { tab: "ARCHIVED" })));
    expect(archivedExport.map((r) => r.name)).toEqual(["Archived Co"]);
    const everything = await exportCompaniesCsv(f.management, await companyFiltersForTab(f.management, { serviceId: f.crm }));
    const text = JSON.stringify(await rowsOf(everything));
    expect(text).toContain("Prospect Co");
    expect(text).not.toContain("8123456"); // the deal's value is not a company column
    expect(everything.columns).not.toEqual(expect.arrayContaining(["value", "dealValue"]));
  });

  it("never lists another organisation's companies", async () => {
    const f = await companyFixture();
    const other = await setup();
    await createCompanyRow(other.org.id, { name: "Theirs Co", lifecycleKey: "DORMANT_CUSTOMER" });
    expect(await names(other.management, {})).toEqual(["Theirs Co"]);
    expect((await listCompanyDirectory(other.management, { tab: "DORMANT" })).total).toBe(1);
    expect(await names(other.management, { serviceId: f.crm })).toEqual([]);
    expect(await names(f.management, { query: "Theirs" })).toEqual([]);
  });
});

describe("contact lists (FIG-1056)", () => {
  async function contactFixture() {
    const f = await setup();
    const { org, sales, otherSales, management } = f;
    const company = await createCompanyRow(org.id, { name: "Hosts Ltd" });
    const mk = (firstName: string, extra: Record<string, unknown> = {}) =>
      adminDb.contact.create({ data: { organizationId: org.id, firstName, companyId: company.id, email: `${firstName.toLowerCase()}@example.test`, phone: "0700000000", ownerMembershipId: sales.membershipId, ...extra } as never });
    const complete = await mk("Complete");
    const solo = await mk("Solo", { companyId: null });
    const noEmail = await mk("NoEmail", { email: null });
    const blankEmail = await mk("BlankEmail", { email: "" });
    const noPhone = await mk("NoPhone", { phone: null });
    const nothing = await mk("Nothing", { companyId: null, email: null, phone: "", ownerMembershipId: otherSales.membershipId });
    const gone = await mk("Gone", { archivedAt: new Date() });
    const vip = await createTag(management, { name: "keycontact" });
    await changeTags(management, "contact", complete.id, { addTagIds: [vip.id] });
    await changeTags(management, "contact", solo.id, { addTagIds: [vip.id] });
    return { ...f, company, complete, solo, noEmail, blankEmail, noPhone, nothing, gone, vip };
  }
  const first = async (ctx: Awaited<ReturnType<typeof setup>>["management"], filters: Parameters<typeof listContactDirectory>[1]) =>
    (await listContactDirectory(ctx, filters, { pageSize: 100 })).items.map((c) => c.firstName).sort();

  it("filters standalone, missing email, missing phone, tag and owner, and excludes archived by default", async () => {
    const f = await contactFixture();
    expect(await first(f.management, {})).toEqual(["BlankEmail", "Complete", "NoEmail", "NoPhone", "Nothing", "Solo"]);
    expect(await first(f.management, { standalone: true })).toEqual(["Nothing", "Solo"]);
    expect(await first(f.management, { missingEmail: true })).toEqual(["BlankEmail", "NoEmail", "Nothing"]);
    expect(await first(f.management, { missingPhone: true })).toEqual(["NoPhone", "Nothing"]);
    expect(await first(f.management, { standalone: true, missingEmail: true })).toEqual(["Nothing"]);
    expect(await first(f.management, { tagIds: [f.vip.id] })).toEqual(["Complete", "Solo"]);
    expect(await first(f.management, { tagIds: [f.vip.id], standalone: true })).toEqual(["Solo"]);
    expect(await first(f.management, { ownerMembershipId: f.otherSales.membershipId })).toEqual(["Nothing"]);
    expect(await first(f.management, { companyId: f.company.id })).toEqual(["BlankEmail", "Complete", "NoEmail", "NoPhone"]);
    expect(await first(f.management, { archived: true })).toEqual(["Gone"]);
    expect(await first(f.management, { query: "solo" })).toEqual(["Solo"]);
  });

  it("counts every quality filter under the other filters, and the counts match the lists", async () => {
    const f = await contactFixture();
    const page = await listContactDirectory(f.management, {}, {});
    expect(page.counts).toEqual({ all: 6, standalone: 2, missingEmail: 3, missingPhone: 2, archived: 1 });
    for (const [key, filter] of [
      ["standalone", { standalone: true }],
      ["missingEmail", { missingEmail: true }],
      ["missingPhone", { missingPhone: true }],
    ] as const) {
      expect((await listContactDirectory(f.management, filter, { pageSize: 100 })).total).toBe(page.counts[key]);
    }
    const owned = await listContactDirectory(f.management, { ownerMembershipId: f.sales.membershipId }, {});
    expect(owned.counts).toEqual({ all: 5, standalone: 1, missingEmail: 2, missingPhone: 1, archived: 1 });
    const tagged = await listContactDirectory(f.management, { tagIds: [f.vip.id], missingEmail: true }, {});
    expect(tagged.total).toBe(0);
    expect(tagged.counts).toEqual({ all: 2, standalone: 1, missingEmail: 0, missingPhone: 0, archived: 0 });
  });

  it("is for roles that can view contacts, exports with the same filters, and stays inside the organisation", async () => {
    const f = await contactFixture();
    await expect(listContactDirectory(f.technical, {})).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listContactDirectory(f.delivery, {})).total).toBe(6);
    await expect(exportContactsCsv(f.delivery, {})).rejects.toBeInstanceOf(ForbiddenError);
    const exported = await rowsOf(await exportContactsCsv(f.management, contactFiltersForExport({ missingEmail: true, standalone: true })));
    expect(exported.map((r) => r.firstName)).toEqual(["Nothing"]);
    const archivedExport = await rowsOf(await exportContactsCsv(f.management, contactFiltersForExport({ archived: true })));
    expect(archivedExport.map((r) => r.firstName)).toEqual(["Gone"]);
    const other = await setup();
    expect((await listContactDirectory(other.management, {})).counts).toEqual({ all: 0, standalone: 0, missingEmail: 0, missingPhone: 0, archived: 0 });
  });
});
