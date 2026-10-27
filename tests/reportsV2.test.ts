import { describe, expect, it } from "vitest";
import { ForbiddenError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { exportReportCsv, getMyMetricsV2, getReport, getReports, REPORT_KEYS, type ReportResult } from "../src/services/reportsV2Service";
import { createTestContext, createTestOrganization, getLeadStatusId, getLostReasonId, getPipelineStageId } from "./helpers/fixtures";
import { createCompanyRow, createWonDeal, day } from "./helpers/stage3";

const NOW = new Date("2026-11-20T09:00:00.000Z");
const RANGE = { dateFrom: "2026-11-01", dateTo: "2026-11-30" };

/**
 * One organisation with a known set of records, so every report has an exact expected total.
 *
 *   November leads  : L1 website/new/A/converted, L2 website/qualified/A/converted, L3 website/new/A,
 *                     L4 referral/new/B, L5 no source/qualified/B
 *   October leads   : O1 website/new/A/converted, O2 referral/new/B
 *   Deals won       : A 100000 + 50000 (Nov), B 30000 (Nov), A 40000 (Oct)
 *   Deals lost (Nov): NO_BUDGET 20000, COMPETITOR 10000; one in Oct
 *   Open deals      : A 10000 + 5000 at Solution presented, B 7000 at Negotiation, one archived
 *   Tasks done      : A 2 (Nov), A 1 (Oct)
 */
async function fixture() {
  const org = await createTestOrganization("ReportsV2");
  const management = await createTestContext(org.id, "MANAGEMENT");
  const a = await createTestContext(org.id, "SALES", "sales.a");
  const b = await createTestContext(org.id, "SALES", "sales.b");
  const delivery = await createTestContext(org.id, "DELIVERY");
  const finance = await createTestContext(org.id, "FINANCE");
  const technical = await createTestContext(org.id, "RESTRICTED_TECHNICAL");
  const source = async (key: string) => (await adminDb.leadSource.findFirstOrThrow({ where: { organizationId: org.id, key } })).id;
  const newStatus = await getLeadStatusId(org.id, "NEW");
  const qualified = await getLeadStatusId(org.id, "QUALIFIED");
  const lead = (owner: typeof a, sourceKey: string | null, statusId: string, createdAt: string, converted: boolean) =>
    adminDb.lead.create({
      data: {
        organizationId: org.id,
        leadStatusId: statusId,
        ownerMembershipId: owner.membershipId,
        leadSourceId: sourceKey ? undefined : undefined,
        createdAt: new Date(`${createdAt}T10:00:00.000Z`),
        convertedAt: converted ? new Date(`${createdAt}T12:00:00.000Z`) : null,
      },
    });
  const web = await source("WEBSITE");
  const ref = await source("REFERRAL");
  const mk = async (owner: typeof a, sourceId: string | null, statusId: string, createdAt: string, converted: boolean) => {
    const l = await lead(owner, null, statusId, createdAt, converted);
    if (sourceId) await adminDb.lead.update({ where: { id: l.id }, data: { leadSourceId: sourceId } });
    return l;
  };
  await mk(a, web, newStatus, "2026-11-05", true);
  await mk(a, web, qualified, "2026-11-05", true);
  await mk(a, web, newStatus, "2026-11-05", false);
  await mk(b, ref, newStatus, "2026-11-05", false);
  await mk(b, null, qualified, "2026-11-05", false);
  await mk(a, web, newStatus, "2026-10-05", true);
  await mk(b, ref, newStatus, "2026-10-05", false);

  await createWonDeal(org.id, a, { value: 100000, wonAt: new Date("2026-11-03T10:00:00.000Z") });
  const secondWon = await createWonDeal(org.id, a, { value: 50000, wonAt: new Date("2026-11-04T10:00:00.000Z") });
  const bWon = await createWonDeal(org.id, b, { value: 30000, wonAt: new Date("2026-11-06T10:00:00.000Z") });
  await createWonDeal(org.id, a, { value: 40000, wonAt: new Date("2026-10-10T10:00:00.000Z") });

  const lostStage = await getPipelineStageId(org.id, "CLOSED_LOST");
  const lose = async (owner: typeof a, reason: string, value: number, lostAt: string) => {
    const company = await createCompanyRow(org.id, { ownerMembershipId: owner.membershipId });
    return adminDb.deal.create({ data: { organizationId: org.id, companyId: company.id, ownerMembershipId: owner.membershipId, pipelineStageId: lostStage, outcome: "LOST", lostAt: new Date(`${lostAt}T10:00:00.000Z`), lostReasonId: await getLostReasonId(org.id, reason), value } });
  };
  await lose(a, "NO_BUDGET", 20000, "2026-11-08");
  await lose(b, "COMPETITOR", 10000, "2026-11-09");
  await lose(a, "TIMING", 99999, "2026-10-09");

  const solution = await getPipelineStageId(org.id, "SOLUTION_PRESENTED");
  const negotiation = await getPipelineStageId(org.id, "NEGOTIATION");
  const open = async (owner: typeof a, stageId: string, value: number, archived = false) => {
    const company = await createCompanyRow(org.id, { ownerMembershipId: owner.membershipId });
    return adminDb.deal.create({ data: { organizationId: org.id, companyId: company.id, ownerMembershipId: owner.membershipId, pipelineStageId: stageId, value, ...(archived ? { archivedAt: new Date() } : {}) } });
  };
  await open(a, solution, 10000);
  await open(a, solution, 5000);
  await open(b, negotiation, 7000);
  await open(a, negotiation, 999999, true);

  const task = (owner: typeof a, status: "COMPLETED" | "PENDING", completedAt: string | null, dueAt: Date | null) =>
    adminDb.task.create({ data: { organizationId: org.id, title: "T", assigneeMembershipId: owner.membershipId, createdByMembershipId: management.membershipId, status, completedAt: completedAt ? new Date(`${completedAt}T10:00:00.000Z`) : null, dueAt } });
  await task(a, "COMPLETED", "2026-11-10", null);
  await task(a, "COMPLETED", "2026-11-11", null);
  await task(a, "COMPLETED", "2026-10-11", null);
  await task(a, "PENDING", null, new Date("2026-11-10T00:00:00.000Z")); // overdue at NOW
  await task(a, "PENDING", null, new Date("2026-12-10T00:00:00.000Z"));

  const company = await createCompanyRow(org.id);
  await adminDb.activity.create({ data: { organizationId: org.id, companyId: company.id, authorMembershipId: a.membershipId, type: "CALL", occurredAt: new Date("2026-11-12T10:00:00.000Z") } });
  await adminDb.activity.create({ data: { organizationId: org.id, companyId: company.id, authorMembershipId: a.membershipId, type: "WHATSAPP", occurredAt: new Date("2026-10-12T10:00:00.000Z") } });
  return { org, management, a, b, delivery, finance, technical, secondWon, bWon };
}

const rows = (r: ReportResult) => r.table.rows;
const col = (r: ReportResult, key: string) => r.table.rows.map((x) => x[key]);

describe("organisation reports (FIG-1055)", () => {
  it("lead sources: counts by source, in the date range only", async () => {
    const f = await fixture();
    const r = await getReport(f.management, "LEAD_SOURCES", RANGE, NOW);
    expect(rows(r)).toEqual([
      { label: "Website", leads: 3 },
      { label: "No source", leads: 1 },
      { label: "Referral", leads: 1 },
    ]);
    expect(r.table.totals).toEqual({ label: "Total", leads: 5 });
    expect(r.scope).toBe("organisation");
    expect(r.range).toMatchObject({ from: new Date("2026-11-01T00:00:00.000Z") });
    expect(r.definition).toMatch(/created in the date range/);
  });

  it("conversion by source and by stage: exact rates, and 0% (never NaN) where nothing converted", async () => {
    const f = await fixture();
    const bySource = await getReport(f.management, "CONVERSION_BY_SOURCE", RANGE, NOW);
    expect(rows(bySource)).toEqual([
      { label: "Website", leads: 3, converted: 2, conversion: 66.7 },
      { label: "No source", leads: 1, converted: 0, conversion: 0 },
      { label: "Referral", leads: 1, converted: 0, conversion: 0 },
    ]);
    expect(bySource.table.totals).toEqual({ label: "Total", leads: 5, converted: 2, conversion: 40 });
    const byStage = await getReport(f.management, "CONVERSION_BY_STAGE", RANGE, NOW);
    expect(rows(byStage)).toEqual([
      { label: "New", leads: 3, converted: 1, conversion: 33.3 },
      { label: "Qualified", leads: 2, converted: 1, conversion: 50 },
    ]);
    for (const value of [...col(bySource, "conversion"), ...col(byStage, "conversion")]) {
      expect(Number.isFinite(value as number)).toBe(true);
    }
    expect(JSON.stringify([bySource, byStage])).not.toMatch(/NaN|UNDEFINED|undefined|Infinity/);
  });

  it("pipeline by stage is a live snapshot of open, un-archived deals", async () => {
    const f = await fixture();
    const r = await getReport(f.management, "PIPELINE_BY_STAGE", RANGE, NOW);
    expect(rows(r)).toEqual([
      { label: "Solution Presented", deals: 2, value: "15000.00" },
      { label: "Negotiation", deals: 1, value: "7000.00" },
    ]);
    expect(r.table.totals).toEqual({ label: "Total", deals: 3, value: "22000.00" });
    expect(r.range).toBeNull();
    expect(r.chart).toMatchObject({ type: "bar", metric: "value" });
  });

  it("lost reasons: counts, shares and value for deals lost in the range", async () => {
    const f = await fixture();
    const r = await getReport(f.management, "LOST_REASONS", RANGE, NOW);
    expect(r.table.rows.map((x) => [x.label, x.deals, x.share, x.value]).sort()).toEqual([
      ["Competitor", 1, 50, "10000.00"],
      ["No Budget", 1, 50, "20000.00"],
    ]);
    expect(r.table.totals).toEqual({ label: "Total", deals: 2, share: 100, value: "30000.00" });
    expect(r.chart.type).toBe("donut");
    const empty = await getReport(f.management, "LOST_REASONS", { dateFrom: "2025-01-01", dateTo: "2025-01-31" }, NOW);
    expect(empty.table).toMatchObject({ rows: [], totals: { deals: 0, share: 0, value: "0.00" } });
  });

  it("per person: leads, conversion, wins and tasks for each salesperson", async () => {
    const f = await fixture();
    const r = await getReport(f.management, "PER_PERSON", RANGE, NOW);
    expect(rows(r).map((x) => ({ ...x, label: x.label === "Test User" ? "someone" : x.label }))).toEqual([
      { label: "someone", leads: 3, converted: 2, conversion: 66.7, dealsWon: 2, wonValue: "150000.00", tasksCompleted: 2 },
      { label: "someone", leads: 2, converted: 0, conversion: 0, dealsWon: 1, wonValue: "30000.00", tasksCompleted: 0 },
    ]);
    expect(r.table.totals).toEqual({ label: "Total", leads: 5, converted: 2, conversion: 40, dealsWon: 3, wonValue: "180000.00", tasksCompleted: 2 });
  });

  it("this month against last: the change, and no percentage when last month was zero", async () => {
    const f = await fixture();
    const r = await getReport(f.management, "MONTH_VS_LAST", {}, NOW);
    expect(rows(r)).toEqual([
      { label: "Leads created", thisMonth: 5, lastMonth: 2, change: 3, changePct: 150 },
      { label: "Leads converted", thisMonth: 2, lastMonth: 1, change: 1, changePct: 100 },
      { label: "Conversion %", thisMonth: 40, lastMonth: 50, change: -10, changePct: -20 },
      { label: "Deals won", thisMonth: 3, lastMonth: 1, change: 2, changePct: 200 },
      { label: "Won value", thisMonth: "180000.00", lastMonth: "40000.00", change: "140000.00", changePct: 350 },
    ]);
    expect(r.chart.compare?.metric).toBe("lastMonth");
    const quiet = await createTestOrganization("ReportsQuiet");
    const m = await createTestContext(quiet.id, "MANAGEMENT");
    const none = await getReport(m, "MONTH_VS_LAST", {}, NOW);
    expect(rows(none).every((x) => x.thisMonth === 0 || x.thisMonth === "0.00")).toBe(true);
    expect(col(none, "changePct")).toEqual([null, null, null, null, null]);
    expect(JSON.stringify(none)).not.toMatch(/NaN/);
  });

  it("customers and renewals snapshots", async () => {
    const f = await fixture();
    const customers = await getReport(f.management, "CUSTOMERS", {}, NOW);
    expect(customers.table.totals).toMatchObject({ customers: 4 });
    expect(rows(customers).map((x) => x.label)).toEqual(["Active", "Repeat", "Dormant"]);
    const [active, , dormant] = col(customers, "customers") as number[];
    expect(active! + dormant!).toBe(4);

    const company = await createCompanyRow(f.org.id);
    const service = (await adminDb.service.findFirstOrThrow({ where: { organizationId: f.org.id, key: "CRM" } })).id;
    const mk = (renewsOn: string, value: string, extra: Record<string, unknown> = {}) =>
      adminDb.recurringService.create({ data: { organizationId: f.org.id, companyId: company.id, serviceId: service, startsOn: day("2026-01-01"), renewsOn: day(renewsOn), value, ...extra } as never });
    await mk("2027-06-01", "1000");
    await mk("2026-12-01", "2000");
    await mk("2026-10-01", "3000");
    await mk("2027-12-01", "4000", { startsOn: day("2027-01-01") });
    await mk("2026-11-25", "9999", { cancelledAt: NOW, cancelReason: "gone" });
    const renewals = await getReport(f.management, "RENEWALS", {}, NOW);
    expect(rows(renewals)).toEqual([
      { label: "Active", services: 1, value: "1000.00" },
      { label: "Due soon", services: 1, value: "2000.00" },
      { label: "Lapsed", services: 1, value: "3000.00" },
      { label: "Starts later", services: 1, value: "4000.00" },
    ]);
    expect(renewals.table.totals).toEqual({ label: "Total", services: 4, value: "10000.00" });
  });

  it("every chart reads the same numbers as its table", async () => {
    const f = await fixture();
    const { reports } = await getReports(f.management, RANGE, NOW);
    expect(reports.map((r) => r.key)).toEqual([...REPORT_KEYS]);
    for (const r of reports) {
      const metric = r.chart.metric;
      expect(r.chart.series.map((s) => s.label)).toEqual(rows(r).map((x) => String(x.label)));
      expect(r.chart.series.map((s) => s.value)).toEqual(rows(r).map((x) => (x[metric] === null ? null : Number(x[metric]))));
      expect(r.definition.length).toBeGreaterThan(20);
      expect(r.table.columns.map((c) => c.key)).toEqual(expect.arrayContaining(["label"]));
    }
  });

  it("hides values from a caller who may not see them and plots counts instead", async () => {
    const f = await fixture();
    const blind = { ...f.management, permissionKeys: f.management.permissionKeys.filter((k) => k !== "deals.view.value") };
    const pipeline = await getReport(blind, "PIPELINE_BY_STAGE", RANGE, NOW);
    expect(pipeline.valueMasked).toBe(true);
    expect(col(pipeline, "value")).toEqual([null, null]);
    expect(pipeline.table.totals).toMatchObject({ deals: 3, value: null });
    expect(pipeline.chart.metric).toBe("deals");
    expect(pipeline.chart.series.map((s) => s.value)).toEqual([2, 1]);
    const person = await getReport(blind, "PER_PERSON", RANGE, NOW);
    expect(col(person, "wonValue")).toEqual([null, null]);
    expect(person.chart.metric).toBe("dealsWon");
    const lost = await getReport(blind, "LOST_REASONS", RANGE, NOW);
    expect(JSON.stringify(lost)).not.toMatch(/10000|20000|30000/);
    expect(JSON.stringify([pipeline, person])).not.toMatch(/150000|30000|22000|15000|7000/);
  });

  it("is for Management; every other role is refused, and unknown reports are a 400", async () => {
    const f = await fixture();
    for (const who of [f.a, f.delivery, f.finance, f.technical]) {
      await expect(getReport(who, "LEAD_SOURCES", RANGE, NOW)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getReports(who, RANGE, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(getReport(f.management, "SECRET", RANGE, NOW)).rejects.toBeInstanceOf(ValidationError);
  });

  it("never mixes in another organisation's records", async () => {
    const f = await fixture();
    const other = await createTestOrganization("ReportsOther");
    const m = await createTestContext(other.id, "MANAGEMENT");
    const r = await getReport(m, "LEAD_SOURCES", RANGE, NOW);
    expect(rows(r)).toEqual([]);
    expect(r.table.totals).toEqual({ label: "Total", leads: 0 });
    expect((await getReport(m, "PIPELINE_BY_STAGE", RANGE, NOW)).table.totals).toMatchObject({ deals: 0 });
    void f;
  });
});

describe("My metrics", () => {
  const card = (r: { cards: { key: string; value: unknown }[] }, key: string) => r.cards.find((c) => c.key === key)?.value;

  it("counts only the caller's own records, for the date range", async () => {
    const f = await fixture();
    const a = await getMyMetricsV2(f.a, RANGE, NOW);
    expect(card(a, "leads")).toBe(3);
    expect(card(a, "converted")).toBe(2);
    expect(card(a, "conversion")).toBe(66.7);
    expect(card(a, "dealsWon")).toBe(2);
    expect(card(a, "wonValue")).toBe("150000.00");
    expect(card(a, "openDeals")).toBe(2);
    expect(card(a, "openValue")).toBe("15000.00");
    expect(card(a, "calls")).toBe(1);
    expect(card(a, "tasksDone")).toBe(2);
    expect(card(a, "tasksOpen")).toBe(2);
    expect(card(a, "tasksOverdue")).toBe(1);
    expect(a.scope).toBe("own");
    expect(a.table.rows).toEqual(a.cards.map((c) => ({ label: c.label, value: c.value })));
    expect(a.cards.every((c) => c.definition.length > 10)).toBe(true);

    const b = await getMyMetricsV2(f.b, RANGE, NOW);
    expect(card(b, "leads")).toBe(2);
    expect(card(b, "conversion")).toBe(0);
    expect(card(b, "dealsWon")).toBe(1);
    expect(card(b, "wonValue")).toBe("30000.00");
    expect(card(b, "openDeals")).toBe(1);
    expect(card(b, "calls")).toBe(0);
    expect(JSON.stringify(b)).not.toMatch(/150000|NaN/);
    // A wider range reaches October.
    const wide = await getMyMetricsV2(f.a, { dateFrom: "2026-10-01", dateTo: "2026-11-30" }, NOW);
    expect(card(wide, "leads")).toBe(4);
    expect(card(wide, "wonValue")).toBe("190000.00");
  });

  it("shows each role the cards that fit it: Delivery handoffs, Finance payments, Technical tasks only", async () => {
    const f = await fixture();
    const handoff = (dealId: string, extra: Record<string, unknown>) =>
      adminDb.dealHandoff.create({ data: { organizationId: f.org.id, dealId, createdByMembershipId: f.a.membershipId, createdAt: new Date("2026-11-07T10:00:00.000Z"), ...extra } as never });
    const delivered = await createWonDeal(f.org.id, f.a, { wonAt: new Date("2026-11-02T10:00:00.000Z") });
    await handoff(f.secondWon.id, { deliveryOwnerMembershipId: f.delivery.membershipId, status: "ONBOARDING" });
    await handoff(delivered.id, { deliveryOwnerMembershipId: f.delivery.membershipId, status: "DELIVERED", deliveredAt: new Date("2026-11-15T10:00:00.000Z"), deliveredByMembershipId: f.delivery.membershipId });
    const d = await getMyMetricsV2(f.delivery, RANGE, NOW);
    expect(card(d, "handoffsTaken")).toBe(2);
    expect(card(d, "handoffsDelivered")).toBe(1);
    expect(card(d, "onboarding")).toBe(1);
    expect(d.cards.some((c) => ["leads", "dealsWon", "wonValue"].includes(c.key))).toBe(false);

    const invoice = await adminDb.invoice.create({ data: { organizationId: f.org.id, companyId: f.secondWon.companyId, dealId: f.secondWon.id, number: "M-1", amount: "1000.00", issuedOn: day("2026-11-01"), dueOn: day("2026-12-01"), status: "SENT", createdByMembershipId: f.finance.membershipId, createdAt: new Date("2026-11-08T10:00:00.000Z") } });
    await adminDb.paymentRecord.create({ data: { organizationId: f.org.id, invoiceId: invoice.id, amount: "400.00", paidOn: day("2026-11-09"), recordedByMembershipId: f.finance.membershipId, createdAt: new Date("2026-11-09T10:00:00.000Z") } });
    const fin = await getMyMetricsV2(f.finance, RANGE, NOW);
    expect(card(fin, "invoicesCreated")).toBe(1);
    expect(card(fin, "paymentsRecorded")).toBe(1);
    expect(card(fin, "amountRecorded")).toBe("400.00");
    expect(fin.cards.some((c) => c.key === "leads" || c.key === "handoffsTaken")).toBe(false);
    // Nobody else is shown what Finance recorded.
    for (const who of [f.a, f.delivery, f.technical]) {
      const mine = await getMyMetricsV2(who, RANGE, NOW).catch(() => null);
      expect(JSON.stringify(mine)).not.toContain("amountRecorded");
    }
    await expect(getMyMetricsV2(f.technical, RANGE, NOW)).rejects.toBeInstanceOf(ForbiddenError); // no reporting permission at all
  });
});

describe("CSV", () => {
  it("is the same table, with a totals row, audited; org reports need the report permission", async () => {
    const f = await fixture();
    const csv = await exportReportCsv(f.management, "CONVERSION_BY_SOURCE", RANGE, NOW);
    expect(csv.split("\n").filter(Boolean)).toEqual(["Source,Leads,Converted,Conversion", "Website,3,2,66.7", "No source,1,0,0", "Referral,1,0,0", "Total,5,2,40"]);
    expect(await adminDb.auditEvent.count({ where: { organizationId: f.org.id, action: "report.exported" } })).toBe(1);
    await expect(exportReportCsv(f.a, "LEAD_SOURCES", RANGE, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    const mine = await exportReportCsv(f.a, "MY_METRICS", RANGE, NOW);
    expect(mine.split("\n")[0]).toBe("Measure,Value");
    expect(mine).toContain("Leads given to me,3");
    expect(mine).not.toContain("NaN");
    const blind = { ...f.management, permissionKeys: f.management.permissionKeys.filter((k) => k !== "deals.view.value") };
    expect(await exportReportCsv(blind, "PIPELINE_BY_STAGE", RANGE, NOW)).not.toMatch(/15000|7000|22000/);
  });
});
