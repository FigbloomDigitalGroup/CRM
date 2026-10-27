import { describe, expect, it } from "vitest";
import { ForbiddenError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { updateReportSettings } from "../src/services/customerReportService";
import { createRecurringService } from "../src/services/recurringServiceService";
import { RETENTION_LISTS, getRenewalsAndRetention } from "../src/services/retentionService";
import { createTestContext, createTestOrganization, getServiceId } from "./helpers/fixtures";
import { createCompanyRow, createWonDeal, daysFrom } from "./helpers/stage3";

const NOW = new Date("2026-11-10T09:00:00.000Z");

async function setup() {
  const org = await createTestOrganization("Retention");
  const management = await createTestContext(org.id, "MANAGEMENT");
  const sales = await createTestContext(org.id, "SALES");
  const otherSales = await createTestContext(org.id, "SALES", "other.sales");
  const delivery = await createTestContext(org.id, "DELIVERY");
  const finance = await createTestContext(org.id, "FINANCE");
  return { org, management, sales, otherSales, delivery, finance };
}

async function touch(organizationId: string, companyId: string, membershipId: string, daysAgo: number) {
  await adminDb.activity.create({ data: { organizationId, companyId, authorMembershipId: membershipId, type: "NOTE", subject: "Touch", occurredAt: daysFrom(NOW, -daysAgo) } });
}

async function sentProposal(organizationId: string, dealId: string, ageDays: number) {
  const p = await adminDb.proposalReference.create({ data: { organizationId, dealId, proposalNumber: `P-${Math.random().toString(36).slice(2, 7)}`, status: "SENT", sentAt: daysFrom(NOW, -ageDays) } });
  await adminDb.$executeRaw`UPDATE proposal_references SET updated_at = ${daysFrom(NOW, -ageDays)} WHERE id = ${p.id}`;
  return p;
}

/** One fixture organisation with a customer in each list, plus a customer that qualifies for several. */
async function fixture() {
  const ctx = await setup();
  const { org, management, sales } = ctx;
  const crm = await getServiceId(org.id, "CRM");
  const starlink = await getServiceId(org.id, "STARLINK_INTERNET").catch(() => getServiceId(org.id, "CCTV"));
  const customer = (name: string, extra: Parameters<typeof createCompanyRow>[1] = {}) =>
    createCompanyRow(org.id, { name, lifecycleKey: "ACTIVE_CUSTOMER", ownerMembershipId: sales.membershipId, createdAt: daysFrom(NOW, -500), ...extra });
  const recur = (companyId: string, renewsOn: string, extra: Record<string, unknown> = {}) =>
    createRecurringService(management, { companyId, serviceId: crm, startsOn: "2025-01-01", renewsOn, value: 50000, ...extra } as never, NOW);

  const lapsed = await customer("Lapsed Ltd");
  await touch(org.id, lapsed.id, sales.membershipId, 1);
  await recur(lapsed.id, "2026-09-20");

  const due = await customer("Due Ltd");
  await touch(org.id, due.id, sales.membershipId, 1);
  await recur(due.id, "2026-11-25");

  const dueLater = await customer("DueLater Ltd");
  await touch(org.id, dueLater.id, sales.membershipId, 1);
  await recur(dueLater.id, "2027-02-01");

  const proposal = await customer("Proposal Ltd");
  await touch(org.id, proposal.id, sales.membershipId, 1);
  const open = await adminDb.deal.create({ data: { organizationId: org.id, companyId: proposal.id, ownerMembershipId: sales.membershipId, pipelineStageId: (await adminDb.pipelineStage.findFirstOrThrow({ where: { organizationId: org.id, key: "PROPOSAL_SENT" } })).id, lastActivityAt: daysFrom(NOW, -1) } });
  await sentProposal(org.id, open.id, 8);

  const quiet = await customer("Quiet Ltd");
  await touch(org.id, quiet.id, sales.membershipId, 60);

  const multi = await customer("Multi Ltd");
  await touch(org.id, multi.id, sales.membershipId, 70);
  await recur(multi.id, "2026-11-30");
  const multiDeal = await adminDb.deal.create({ data: { organizationId: org.id, companyId: multi.id, ownerMembershipId: sales.membershipId, pipelineStageId: open.pipelineStageId, lastActivityAt: daysFrom(NOW, -70) } });
  await sentProposal(org.id, multiDeal.id, 9);

  // Similar customers in one industry: three hold Starlink-like service, one does not.
  const peers = [];
  for (const n of ["Peer A", "Peer B"]) {
    const p = await customer(n, { industry: "Hospitality" });
    await touch(org.id, p.id, sales.membershipId, 1);
    await adminDb.companyService.create({ data: { organizationId: org.id, companyId: p.id, serviceId: starlink, status: "ACTIVE" } });
    peers.push(p);
  }
  const target = await customer("Hotel Target", { industry: "hospitality" });
  await touch(org.id, target.id, sales.membershipId, 1);

  const healthy = await customer("Healthy Ltd");
  await touch(org.id, healthy.id, sales.membershipId, 1);
  const prospect = await createCompanyRow(org.id, { name: "Just A Prospect", lifecycleKey: "PROSPECT", ownerMembershipId: sales.membershipId });
  const dormant = await customer("Dormant Ltd", { lifecycleKey: "DORMANT_CUSTOMER" });
  return { ...ctx, lapsed, due, dueLater, proposal, quiet, multi, target, healthy, prospect, dormant, peers, starlink };
}

describe("renewals and retention lists (FIG-1052)", () => {
  it("puts each customer in exactly one primary list, with the reason, and the counts match the lists", async () => {
    const f = await fixture();
    const result = await getRenewalsAndRetention(f.management, {}, NOW);
    const names = (k: (typeof RETENTION_LISTS)[number]) => result.lists[k]!.items.map((r) => r.companyName).sort();

    expect(names("LAPSED")).toEqual(["Lapsed Ltd"]);
    expect(names("DUE_30")).toEqual(["Due Ltd", "Multi Ltd"]);
    expect(names("UNANSWERED_PROPOSALS")).toEqual(["Proposal Ltd"]);
    expect(names("GOING_QUIET")).toEqual(["Quiet Ltd"]);
    expect(names("CROSS_SELL")).toEqual(["Hotel Target"]);
    expect(result.counts).toEqual({ LAPSED: 1, DUE_30: 2, UNANSWERED_PROPOSALS: 1, GOING_QUIET: 1, CROSS_SELL: 1 });
    expect(result.total).toBe(6);
    for (const k of RETENTION_LISTS) expect(result.counts[k]).toBe(result.lists[k]!.total);

    const every = RETENTION_LISTS.flatMap((k) => result.lists[k]!.items.map((r) => r.companyId));
    expect(new Set(every).size).toBe(every.length); // exactly one list each
    const shown = new Set(every);
    for (const absent of [f.healthy, f.prospect, f.dormant, f.dueLater]) expect(shown.has(absent.id)).toBe(false);

    const lapsed = result.lists.LAPSED!.items[0]!;
    expect(lapsed).toMatchObject({ list: "LAPSED", reason: "CRM lapsed 51 days ago.", suggestedAction: { type: "RENEW_SERVICE" }, ownerMembershipId: f.sales.membershipId });
    expect(lapsed.service).toMatchObject({ name: "CRM", state: "LAPSED", value: "50000.00" });
    const multi = result.lists.DUE_30!.items.find((r) => r.companyName === "Multi Ltd")!;
    expect(multi.reason).toBe("CRM renews in 20 days.");
    expect(multi.alsoMatches.map((m) => m.list).sort()).toEqual(["GOING_QUIET", "UNANSWERED_PROPOSALS"]);
    const proposal = result.lists.UNANSWERED_PROPOSALS!.items[0]!;
    expect(proposal).toMatchObject({ reason: expect.stringContaining("sent 8 days ago"), suggestedAction: { type: "FOLLOW_UP_PROPOSAL" }, proposal: { daysSinceSent: 8 } });
    const quiet = result.lists.GOING_QUIET!.items[0]!;
    expect(quiet).toMatchObject({ quietDays: 60, reason: "No contact for 60 days; the customer becomes dormant after 90 days." });
    const cross = result.lists.CROSS_SELL!.items[0]!;
    expect(cross.suggestions).toEqual([{ serviceId: f.starlink, serviceName: expect.any(String), similarCustomers: 2 }]);
    expect(cross.reason).toMatch(/^2 similar customers in hospitality use /i);
    expect(result.thresholds).toEqual({ dormancyDays: 90, goingQuietFromDays: 45, proposalFollowUpDays: 5, dueWithinDays: 30, graceDays: 14 });
    expect(result.scope).toBe("organisation");
  });

  it("orders each list by urgency and pages it, one list at a time", async () => {
    const f = await fixture();
    const first = await getRenewalsAndRetention(f.management, { list: "DUE_30", pageSize: 1 }, NOW);
    expect(Object.keys(first.lists)).toEqual(["DUE_30"]);
    expect(first.lists.DUE_30).toMatchObject({ total: 2, pageCount: 2 });
    expect(first.lists.DUE_30!.items[0]!.companyName).toBe("Due Ltd"); // 15 days before 20 days
    const second = await getRenewalsAndRetention(f.management, { list: "DUE_30", pageSize: 1, cursor: first.lists.DUE_30!.nextCursor! }, NOW);
    expect(second.lists.DUE_30!.items[0]!.companyName).toBe("Multi Ltd");
    expect(first.counts.DUE_30).toBe(2); // counts are never trimmed by paging
    await expect(getRenewalsAndRetention(f.management, { list: "NOPE" }, NOW)).rejects.toBeInstanceOf(ValidationError);
  });

  it("scopes by owner: Sales sees its own customers, Management sees all, and a colleague sees nothing of them", async () => {
    const f = await fixture();
    const mine = await getRenewalsAndRetention(f.sales, {}, NOW);
    const all = await getRenewalsAndRetention(f.management, {}, NOW);
    expect(mine.scope).toBe("own");
    expect(mine.counts).toEqual(all.counts);
    const theirs = await getRenewalsAndRetention(f.otherSales, {}, NOW);
    expect(theirs.total).toBe(0);
    expect(theirs.counts).toEqual({ LAPSED: 0, DUE_30: 0, UNANSWERED_PROPOSALS: 0, GOING_QUIET: 0, CROSS_SELL: 0 });
    // Reassign one customer: it moves to the other salesperson's view.
    await adminDb.company.update({ where: { id: f.quiet.id }, data: { ownerMembershipId: f.otherSales.membershipId } });
    expect((await getRenewalsAndRetention(f.otherSales, {}, NOW)).counts.GOING_QUIET).toBe(1);
    expect((await getRenewalsAndRetention(f.sales, {}, NOW)).counts.GOING_QUIET).toBe(0);
    expect((await getRenewalsAndRetention(f.management, {}, NOW)).counts.GOING_QUIET).toBe(1);
  });

  it("refuses roles that do not act on renewals", async () => {
    const f = await fixture();
    await expect(getRenewalsAndRetention(f.delivery, {}, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getRenewalsAndRetention(f.finance, {}, NOW)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("shows a service's value to the person who owns it and to Management", async () => {
    const f = await fixture();
    const own = await getRenewalsAndRetention(f.sales, {}, NOW);
    expect(own.lists.LAPSED!.items[0]!.service).toMatchObject({ value: "50000.00", valueMasked: false });
    const all = await getRenewalsAndRetention(f.management, {}, NOW);
    expect(all.lists.LAPSED!.items[0]!.service).toMatchObject({ value: "50000.00", valueMasked: false });
    // Handed to a colleague who does not own the service, the row leaves the salesperson's view altogether.
    await adminDb.recurringService.updateMany({ where: { organizationId: f.org.id }, data: { ownerMembershipId: f.otherSales.membershipId } });
    const moved = await getRenewalsAndRetention(f.sales, {}, NOW);
    expect(moved.lists.LAPSED!.items).toHaveLength(0);
    expect(JSON.stringify(moved)).not.toContain("50000");
  });

  it("follows the organisation's thresholds: dormancy, grace, proposal follow-up", async () => {
    const f = await fixture();
    await updateReportSettings(f.management, { dormancyDays: 200 });
    const wide = await getRenewalsAndRetention(f.management, {}, NOW);
    expect(wide.thresholds.goingQuietFromDays).toBe(100);
    expect(wide.counts.GOING_QUIET).toBe(0); // 60 days quiet is not yet half of 200
    await updateReportSettings(f.management, { dormancyDays: 70 });
    const narrow = await getRenewalsAndRetention(f.management, {}, NOW);
    expect(narrow.lists.GOING_QUIET!.items.map((r) => r.companyName)).toEqual(["Quiet Ltd"]);
    await adminDb.organizationSetting.upsert({
      where: { organizationId_key: { organizationId: f.org.id, key: "renewals.settings" } },
      update: { value: { dueSoonDays: 30, graceDays: 90 } },
      create: { organizationId: f.org.id, key: "renewals.settings", value: { dueSoonDays: 30, graceDays: 90 } },
    });
    const graced = await getRenewalsAndRetention(f.management, {}, NOW);
    expect(graced.counts.LAPSED).toBe(0); // 51 days late is inside a 90-day grace
    expect(graced.lists.DUE_30!.items.map((r) => r.companyName)).toContain("Lapsed Ltd");
  });

  it("only lists customers of its own organisation", async () => {
    const f = await fixture();
    const other = await setup();
    const empty = await getRenewalsAndRetention(other.management, {}, NOW);
    expect(empty.total).toBe(0);
    const company = await createCompanyRow(other.org.id, { lifecycleKey: "ACTIVE_CUSTOMER", ownerMembershipId: other.sales.membershipId, createdAt: daysFrom(NOW, -500) });
    await createWonDeal(other.org.id, other.sales, { companyId: company.id });
    const theirs = await getRenewalsAndRetention(other.management, {}, NOW);
    expect(JSON.stringify(theirs)).not.toContain(f.lapsed.id);
    expect(theirs.total).toBeGreaterThanOrEqual(0);
  });
});
