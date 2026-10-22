import { describe, expect, it } from "vitest";
import { ForbiddenError, ValidationError } from "../src/auth/errors";
import type { AuthContext } from "../src/auth/context";
import { adminDb } from "../src/db/adminClient";
import * as customerReports from "../src/services/customerReportService";
import { exportCustomerReportsCsv } from "../src/services/exportService";
import {
  createTestContext,
  createTestOrganization,
  getPipelineStageId,
  getServiceId,
} from "./helpers/fixtures";

/**
 * FIG-793: customer reports (active / repeat / dormant, won by salesperson,
 * upcoming renewals) on fixed fixtures, with role scoping, value masking and
 * tenant isolation.
 */

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

async function setup() {
  const org = await createTestOrganization("CustReports");
  const mgmt = await createTestContext(org.id, "MANAGEMENT", "cr.mgmt");
  const salesA = await createTestContext(org.id, "SALES", "cr.salesA");
  const salesB = await createTestContext(org.id, "SALES", "cr.salesB");
  const delivery = await createTestContext(org.id, "DELIVERY", "cr.delivery");
  const finance = await createTestContext(org.id, "FINANCE", "cr.finance");
  const stageId = await getPipelineStageId(org.id, "CLOSED_WON");
  const serviceId = await getServiceId(org.id);

  const company = (name: string) =>
    adminDb.company.create({ data: { organizationId: org.id, name } });
  const won = (
    companyId: string,
    owner: AuthContext,
    value: number,
    wonAt: Date,
    svc: string | null = serviceId,
  ) =>
    adminDb.deal.create({
      data: {
        organizationId: org.id,
        companyId,
        ownerMembershipId: owner.membershipId,
        pipelineStageId: stageId,
        serviceId: svc,
        value,
        outcome: "WON",
        wonAt,
      },
    });

  // Fixed fixtures (days relative to now):
  //  Recent Co   one win 10 days ago               -> active
  //  Repeat Co   wins 400 and 20 days ago          -> active + repeat
  //  Old Co      one win 200 days ago              -> dormant
  //  Retainer Co one win 300 days ago, ACTIVE svc  -> active (service keeps it so)
  //  Twice Old   wins 500 and 250 days ago         -> dormant + repeat
  //  Prospect Co no wins, no service               -> not a customer
  const recent = await company("Recent Co");
  const repeat = await company("Repeat Co");
  const old = await company("Old Co");
  const retainer = await company("Retainer Co");
  const twiceOld = await company("Twice Old");
  await company("Prospect Co");

  await won(recent.id, salesA, 1000, daysAgo(10));
  await won(repeat.id, salesA, 2000, daysAgo(400));
  await won(repeat.id, salesB, 3000, daysAgo(20));
  await won(old.id, salesB, 500, daysAgo(200));
  await won(retainer.id, salesB, 700, daysAgo(300));
  await won(twiceOld.id, salesA, 100, daysAgo(500));
  await won(twiceOld.id, salesA, 200, daysAgo(250));

  const link = (
    companyId: string,
    endDate: Date | null,
    status: "ACTIVE" | "COMPLETED" | "CANCELLED" = "ACTIVE",
  ) =>
    adminDb.companyService.create({
      data: { organizationId: org.id, companyId, serviceId, status, endDate },
    });
  await link(retainer.id, null);

  return {
    org, mgmt, salesA, salesB, delivery, finance, serviceId, stageId,
    companies: { recent, repeat, old, retainer, twiceOld }, won, link, company,
  };
}

describe("customer report: active, repeat and dormant", () => {
  it("segments customers with the default 90-day threshold", async () => {
    const { mgmt } = await setup();
    const report = await customerReports.getCustomerReport(mgmt);

    expect(report.dormancyDays).toBe(90);
    expect(report.summary).toEqual({ customers: 5, active: 3, repeat: 2, dormant: 2 });
    const byName = Object.fromEntries(report.items.map((r) => [r.companyName, r]));
    expect(byName["Recent Co"]).toMatchObject({ segment: "active", repeat: false, wonCount: 1 });
    expect(byName["Repeat Co"]).toMatchObject({ segment: "active", repeat: true, wonCount: 2 });
    expect(byName["Old Co"]).toMatchObject({ segment: "dormant", repeat: false });
    expect(byName["Retainer Co"]).toMatchObject({ segment: "active", activeServices: 1 });
    expect(byName["Twice Old"]).toMatchObject({ segment: "dormant", repeat: true });
    expect(byName["Prospect Co"]).toBeUndefined();
    expect(Number(byName["Repeat Co"]!.wonValue)).toBe(5000);
    // Most recent win first.
    expect(report.items[0]!.companyName).toBe("Recent Co");
  });

  it("honours a per-request threshold and filters by segment", async () => {
    const { mgmt } = await setup();
    const tight = await customerReports.getCustomerReport(mgmt, { dormantAfterDays: 25 });
    expect(tight.summary).toMatchObject({ customers: 5, active: 3, dormant: 2 });
    const tighter = await customerReports.getCustomerReport(mgmt, { dormantAfterDays: 5 });
    // Only Retainer Co (running service) is still active.
    expect(tighter.summary).toMatchObject({ active: 1, dormant: 4 });

    const dormant = await customerReports.getCustomerReport(mgmt, { segment: "dormant" });
    expect(dormant.items.map((r) => r.companyName).sort()).toEqual(["Old Co", "Twice Old"]);
    expect(dormant.total).toBe(2);
    const repeat = await customerReports.getCustomerReport(mgmt, { segment: "repeat" });
    expect(repeat.items.map((r) => r.companyName).sort()).toEqual(["Repeat Co", "Twice Old"]);
    // The summary always counts every customer, whatever the filter.
    expect(repeat.summary.customers).toBe(5);
  });

  it("treats a service past its end date, or a finished one, as not keeping a customer active", async () => {
    const { mgmt, companies, link } = await setup();
    await link(companies.old.id, daysAgo(30), "ACTIVE");
    await link(companies.twiceOld.id, null, "COMPLETED");
    const report = await customerReports.getCustomerReport(mgmt);
    expect(report.summary).toMatchObject({ active: 3, dormant: 2 });
  });

  it("uses the organization's saved threshold, and the saved value is validated, audited and permissioned", async () => {
    const { mgmt, salesA, org } = await setup();
    expect(await customerReports.getReportSettings(mgmt)).toEqual({ dormancyDays: 90 });

    await expect(customerReports.updateReportSettings(salesA, { dormancyDays: 30 })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    for (const bad of [0, -5, 1.5, 4000, Number.NaN]) {
      await expect(customerReports.updateReportSettings(mgmt, { dormancyDays: bad })).rejects.toBeInstanceOf(
        ValidationError,
      );
    }

    expect(await customerReports.updateReportSettings(mgmt, { dormancyDays: 5 })).toEqual({ dormancyDays: 5 });
    const report = await customerReports.getCustomerReport(mgmt);
    expect(report.dormancyDays).toBe(5);
    expect(report.summary).toMatchObject({ active: 1, dormant: 4 });
    // A request override still wins over the saved value.
    expect((await customerReports.getCustomerReport(mgmt, { dormantAfterDays: 90 })).summary.active).toBe(3);

    const audit = await adminDb.auditEvent.findMany({
      where: { organizationId: org.id, action: "report_settings.updated" },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.newValue).toEqual({ dormancyDays: 5 });
    expect(audit[0]!.previousValue).toEqual({ dormancyDays: 90 });
  });

  it("pages the rows and rejects a bad threshold", async () => {
    const { mgmt } = await setup();
    const p1 = await customerReports.getCustomerReport(mgmt, {}, { page: 1, pageSize: 2 });
    const p3 = await customerReports.getCustomerReport(mgmt, {}, { page: 3, pageSize: 2 });
    expect(p1).toMatchObject({ total: 5, pageCount: 3 });
    expect(p1.items).toHaveLength(2);
    expect(p3.items).toHaveLength(1);
    await expect(customerReports.getCustomerReport(mgmt, { dormantAfterDays: 0 })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("is Management-only", async () => {
    const { salesA, delivery, finance } = await setup();
    for (const ctx of [salesA, delivery, finance]) {
      await expect(customerReports.getCustomerReport(ctx)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});

describe("won by salesperson", () => {
  it("totals won count and value per owner in the window", async () => {
    const { mgmt, salesA, salesB } = await setup();
    const report = await customerReports.getSalesBySalesperson(mgmt, {
      dateFrom: daysAgo(365).toISOString(),
    });
    const byOwner = Object.fromEntries(
      report.rows.map((r) => [r.ownerMembershipId, [r.wonCount, Number(r.wonValue)]]),
    );
    // Inside 365 days: A = 1000 + 200 + 0; B = 3000 + 500 + 700.
    expect(byOwner[salesA.membershipId]).toEqual([2, 1200]);
    expect(byOwner[salesB.membershipId]).toEqual([3, 4200]);
    expect(report.rows.every((r) => r.ownerName)).toBe(true);
    expect(report.period).toBe("total");
    expect(report.valueMasked).toBe(false);
    // Highest count first.
    expect(report.rows[0]!.ownerMembershipId).toBe(salesB.membershipId);
  });

  it("filters by owner and service and respects the date window", async () => {
    const { mgmt, salesA, org } = await setup();
    const other = await adminDb.service.create({
      data: { organizationId: org.id, key: "OTHER", name: "Other service" },
    });
    const co = await adminDb.company.create({ data: { organizationId: org.id, name: "Svc Co" } });
    await adminDb.deal.create({
      data: {
        organizationId: org.id,
        companyId: co.id,
        ownerMembershipId: salesA.membershipId,
        pipelineStageId: await getPipelineStageId(org.id, "CLOSED_WON"),
        serviceId: other.id,
        value: 50,
        outcome: "WON",
        wonAt: daysAgo(2),
      },
    });

    const mine = await customerReports.getSalesBySalesperson(mgmt, {
      ownerMembershipId: salesA.membershipId,
      dateFrom: daysAgo(30).toISOString(),
    });
    expect(mine.rows.map((r) => [r.wonCount, Number(r.wonValue)])).toEqual([[2, 1050]]);

    const bySvc = await customerReports.getSalesBySalesperson(mgmt, {
      serviceId: other.id,
      dateFrom: daysAgo(30).toISOString(),
    });
    expect(bySvc.rows.map((r) => [r.wonCount, Number(r.wonValue)])).toEqual([[1, 50]]);

    const none = await customerReports.getSalesBySalesperson(mgmt, {
      dateFrom: daysAgo(3000).toISOString(),
      dateTo: daysAgo(2000).toISOString(),
    });
    expect(none.rows).toEqual([]);
  });

  it("splits by calendar month when asked", async () => {
    const { org, mgmt, salesA } = await setup();
    const co = await adminDb.company.create({ data: { organizationId: org.id, name: "Month Co" } });
    const stage = await getPipelineStageId(org.id, "CLOSED_WON");
    for (const [iso, value] of [
      ["2031-01-10T10:00:00Z", 10],
      ["2031-01-25T10:00:00Z", 20],
      ["2031-02-03T10:00:00Z", 40],
    ] as const) {
      await adminDb.deal.create({
        data: {
          organizationId: org.id, companyId: co.id, ownerMembershipId: salesA.membershipId,
          pipelineStageId: stage, value, outcome: "WON", wonAt: new Date(iso),
        },
      });
    }
    const report = await customerReports.getSalesBySalesperson(mgmt, {
      dateFrom: "2031-01-01",
      dateTo: "2031-02-28",
      period: "month",
    });
    expect(report.period).toBe("month");
    expect(report.rows.map((r) => [r.month, r.wonCount, Number(r.wonValue)])).toEqual([
      ["2031-01", 2, 30],
      ["2031-02", 1, 40],
    ]);
  });

  it("gives a rep only their own row and a Delivery user masked values", async () => {
    const { salesA, salesB, delivery, finance } = await setup();
    const window = { dateFrom: daysAgo(365).toISOString() };

    // Sales (own-only): just themselves, values visible because they own the deals;
    // an owner filter pointing at a colleague cannot widen it.
    const own = await customerReports.getSalesBySalesperson(salesA, {
      ...window,
      ownerMembershipId: salesB.membershipId,
    });
    expect(own.rows.map((r) => r.ownerMembershipId)).toEqual([salesA.membershipId]);
    expect(own.valueMasked).toBe(false);
    expect(Number(own.rows[0]!.wonValue)).toBe(1200);

    // Delivery sees every deal but has no value permission: counts only.
    const del = await customerReports.getSalesBySalesperson(delivery, window);
    expect(del.rows).toHaveLength(2);
    expect(del.valueMasked).toBe(true);
    expect(del.rows.every((r) => r.wonValue === null && r.wonCount > 0)).toBe(true);

    // Finance has the value permission.
    const fin = await customerReports.getSalesBySalesperson(finance, window);
    expect(fin.valueMasked).toBe(false);
    expect(fin.rows.every((r) => r.wonValue !== null)).toBe(true);
  });
});

describe("upcoming renewals", () => {
  it("lists active services ending in the window, soonest first, with lapsed ones flagged", async () => {
    const { org, mgmt, link, company, companies } = await setup();
    const day = (n: number) => new Date(Date.now() + n * DAY);
    const later = await company("Later Co");
    const farAway = await company("Far Co");
    await link(companies.recent.id, day(10));
    await link(later.id, day(60));
    await link(farAway.id, day(200));
    await link(companies.old.id, day(-5)); // still ACTIVE past its end date
    await link(companies.twiceOld.id, day(20), "COMPLETED");
    await link(companies.repeat.id, day(30), "CANCELLED");
    await link(companies.retainer.id, null); // open-ended: never renews

    const report = await customerReports.getUpcomingRenewals(mgmt);
    expect(report.withinDays).toBe(90);
    expect(report.items.map((r) => r.companyName)).toEqual(["Old Co", "Recent Co", "Later Co"]);
    expect(report.items.map((r) => r.lapsed)).toEqual([true, false, false]);
    expect(report.items[1]!.daysLeft).toBeGreaterThanOrEqual(9);
    expect(report.items[1]!.daysLeft).toBeLessThanOrEqual(10);
    expect(report.summary).toEqual({ renewing: 2, lapsed: 1 });
    expect(report.items[0]).toHaveProperty("serviceName");

    const wide = await customerReports.getUpcomingRenewals(mgmt, { withinDays: 365 });
    expect(wide.items.map((r) => r.companyName)).toEqual(["Old Co", "Recent Co", "Later Co", "Far Co"]);
    const narrow = await customerReports.getUpcomingRenewals(mgmt, { withinDays: 30 });
    expect(narrow.items.map((r) => r.companyName)).toEqual(["Old Co", "Recent Co"]);

    await expect(customerReports.getUpcomingRenewals(mgmt, { withinDays: 0 })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(org.id).toBeTruthy();
  });

  it("excludes archived companies and is Management-only", async () => {
    const { mgmt, salesA, finance, link, company } = await setup();
    const archived = await company("Archived Co");
    await adminDb.company.update({ where: { id: archived.id }, data: { archivedAt: new Date() } });
    await link(archived.id, new Date(Date.now() + 5 * DAY));
    expect((await customerReports.getUpcomingRenewals(mgmt)).items).toEqual([]);
    await expect(customerReports.getUpcomingRenewals(salesA)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(customerReports.getUpcomingRenewals(finance)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("tenant isolation", () => {
  it("never mixes another organization's customers, sales or renewals in", async () => {
    const a = await setup();
    const b = await setup();
    await a.link(a.companies.recent.id, new Date(Date.now() + 5 * DAY));

    const customersB = await customerReports.getCustomerReport(b.mgmt);
    expect(customersB.summary.customers).toBe(5);
    const idsA = new Set((await customerReports.getCustomerReport(a.mgmt)).items.map((r) => r.companyId));
    expect(customersB.items.some((r) => idsA.has(r.companyId))).toBe(false);

    const salesB = await customerReports.getSalesBySalesperson(b.mgmt, {
      dateFrom: daysAgo(365).toISOString(),
    });
    expect(salesB.rows.some((r) => r.ownerMembershipId === a.salesA.membershipId)).toBe(false);

    expect((await customerReports.getUpcomingRenewals(b.mgmt)).items).toEqual([]);
  });
});

describe("customer reports CSV", () => {
  it("exports the three reports with the same rules, and only to roles that may export", async () => {
    const { mgmt, salesA, delivery } = await setup();
    const csv = await exportCustomerReportsCsv(mgmt, { dateFrom: daysAgo(365).toISOString() });
    expect(csv).toContain("Customer summary");
    expect(csv).toContain("Customers");
    expect(csv).toContain("Won by salesperson");
    expect(csv).toContain("Upcoming renewals");
    expect(csv).toContain("Repeat Co,active,yes,2,5000");
    expect(csv).toContain("Old Co,dormant,no,1,500");
    expect(csv).not.toContain("Prospect Co");

    await expect(exportCustomerReportsCsv(salesA)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(exportCustomerReportsCsv(delivery)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
