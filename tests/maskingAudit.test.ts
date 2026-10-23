import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError } from "../src/auth/errors";
import type { AuthContext } from "../src/auth/context";
import { maskAuditSnapshot, maskDeal, redactMoneyText, textForViewer } from "../src/auth/masking";
import * as activityService from "../src/services/activityService";
import * as auditService from "../src/services/auditService";
import * as companyService from "../src/services/companyService";
import * as customerReportService from "../src/services/customerReportService";
import * as dealService from "../src/services/dealService";
import * as exportService from "../src/services/exportService";
import * as proposalService from "../src/services/proposalService";
import * as reportingService from "../src/services/reportingService";
import * as searchService from "../src/services/searchService";
import { createTestContext, createTestOrganization, getPipelineStageId } from "./helpers/fixtures";

/**
 * FIG-1036 (B2.07): deal value and margin masking audit. One deal and one won
 * deal carry sentinel figures; every surface that can carry a deal value is
 * called as every role, and the serialised response of a role that may not see
 * values must not contain the sentinels anywhere, in any key or in any text.
 * A surface added later belongs in `surfaces` below (docs/MASKING.md).
 */

const OPEN_VALUE = 98765.43;
const WON_VALUE = 87654.32;
const PROPOSAL_AMOUNT = 54321.09;
const LEAKS = [/98[,.]?765/, /87[,.]?654/, /54[,.]?321/];

type Surface = { name: string; call: (ctx: AuthContext) => Promise<unknown> };

async function drain(rows: AsyncIterable<Record<string, unknown>>) {
  const out: Record<string, unknown>[] = [];
  for await (const row of rows) out.push(row);
  return out;
}

async function setup() {
  const org = await createTestOrganization();
  const management = await createTestContext(org.id, "MANAGEMENT");
  const owner = await createTestContext(org.id, "SALES", "owner.sales");
  const otherSales = await createTestContext(org.id, "SALES", "other.sales");
  const finance = await createTestContext(org.id, "FINANCE");
  const delivery = await createTestContext(org.id, "DELIVERY");
  const technical = await createTestContext(org.id, "RESTRICTED_TECHNICAL");
  const support = await createTestContext(org.id, "CUSTOMER_SUPPORT");

  const { company } = await companyService.createCompany(management, { name: "Sentinel Corp" });
  const openStageId = await getPipelineStageId(org.id);
  const wonStageId = await getPipelineStageId(org.id, "CLOSED_WON");

  const openDeal = await dealService.createDeal(owner, {
    companyId: company.id,
    pipelineStageId: openStageId,
    value: OPEN_VALUE,
    currency: "KES",
  });
  const wonDeal = await dealService.createDeal(management, {
    companyId: company.id,
    pipelineStageId: openStageId,
    value: WON_VALUE,
    currency: "KES",
  });
  await dealService.updateDeal(management, wonDeal.id, {
    pipelineStageId: wonStageId,
    handoff: { deliveryOwnerMembershipId: delivery.membershipId },
  });
  // A later edit puts the figure into the audit snapshots too.
  await dealService.updateDeal(management, wonDeal.id, { value: WON_VALUE + 0.5 });
  await dealService.updateDeal(owner, openDeal.id, { value: OPEN_VALUE + 0.5 });
  await proposalService.createProposalReference(owner, openDeal.id, { proposalNumber: "P-1", amount: PROPOSAL_AMOUNT });

  return { org, management, owner, otherSales, finance, delivery, technical, support, company, openDeal, wonDeal };
}

describe("deal value masking audit (FIG-1036, B2.07)", () => {
  it("no surface leaks a deal value or proposal amount to a role that may not see values", async () => {
    const s = await setup();

    const surfaces: Surface[] = [
      { name: "deals list", call: (c) => dealService.listDeals(c, { includeArchived: true }) },
      { name: "deals page", call: (c) => dealService.listDealsPage(c, {}, { pageSize: 100 }) },
      { name: "deal detail (open)", call: (c) => dealService.getDeal(c, s.openDeal.id) },
      { name: "deal detail (won)", call: (c) => dealService.getDeal(c, s.wonDeal.id) },
      { name: "deal summary", call: (c) => dealService.getDealSummary(c) },
      { name: "global search", call: (c) => searchService.globalSearch(c, "Sentinel") },
      { name: "organisation metrics", call: (c) => reportingService.getOrganizationMetrics(c, {}) },
      { name: "my metrics", call: (c) => reportingService.getMyMetrics(c, {}) },
      { name: "my actionable work", call: (c) => reportingService.getMyActionableWork(c) },
      { name: "proposals", call: (c) => proposalService.listProposalReferences(c, s.openDeal.id) },
      { name: "audit history (open deal)", call: (c) => auditService.listAuditHistory(c, "Deal", s.openDeal.id) },
      { name: "audit history (won deal)", call: (c) => auditService.listAuditHistory(c, "Deal", s.wonDeal.id) },
      { name: "deal timeline", call: (c) => activityService.listActivitiesForDeal(c, s.openDeal.id) },
      { name: "company timeline", call: (c) => activityService.listActivitiesForCompany(c, s.company.id) },
      { name: "company detail", call: (c) => companyService.getCompany(c, s.company.id) },
      { name: "customer report", call: (c) => customerReportService.getCustomerReport(c, {}) },
      { name: "sales by salesperson", call: (c) => customerReportService.getSalesBySalesperson(c, {}) },
      { name: "renewals", call: (c) => customerReportService.getUpcomingRenewals(c, {}) },
      { name: "deals CSV export", call: async (c) => drain((await exportService.exportDealsCsv(c, {})).rows) },
      { name: "reports CSV export", call: (c) => exportService.exportReportsCsv(c, {}) },
      { name: "customer reports CSV export", call: (c) => exportService.exportCustomerReportsCsv(c, {}) },
    ];

    const masked: [string, AuthContext][] = [
      ["DELIVERY", s.delivery],
      ["RESTRICTED_TECHNICAL", s.technical],
      ["CUSTOMER_SUPPORT", s.support],
      ["SALES (not the owner)", s.otherSales],
    ];

    const checked: string[] = [];
    for (const [role, ctx] of masked) {
      for (const surface of surfaces) {
        let result: unknown;
        try {
          result = await surface.call(ctx);
        } catch (err) {
          if (err instanceof ForbiddenError || err instanceof NotFoundError) continue; // refused outright is also safe
          throw new Error(`${role} / ${surface.name}: ${(err as Error).message}`);
        }
        const text = JSON.stringify(result);
        for (const leak of LEAKS) {
          expect(text, `${role} sees a value on "${surface.name}"`).not.toMatch(leak);
        }
        checked.push(`${role}/${surface.name}`);
      }
    }
    // The scan really ran against data: Delivery reaches the won deal.
    expect(checked.length).toBeGreaterThan(20);
    expect(checked).toContain("DELIVERY/deal detail (won)");
  });

  it("the scan itself works: roles that may see values do see the sentinel", async () => {
    const s = await setup();
    const asManagement = JSON.stringify(await dealService.getDeal(s.management, s.openDeal.id));
    expect(asManagement).toMatch(LEAKS[0]!);
    // Finance sees won deals only (signed departure, B1.03), with their values.
    const asFinance = JSON.stringify(await dealService.listDeals(s.finance, {}));
    expect(asFinance).toMatch(LEAKS[1]!);
    // The owner sees the value they quoted, and the proposal amount on their own deal.
    expect(JSON.stringify(await dealService.getDeal(s.owner, s.openDeal.id))).toMatch(LEAKS[0]!);
    expect(JSON.stringify(await proposalService.listProposalReferences(s.owner, s.openDeal.id))).toMatch(LEAKS[2]!);
    expect(JSON.stringify(await auditService.listAuditHistory(s.management, "Deal", s.openDeal.id))).toMatch(LEAKS[0]!);
  });

  it("another Sales user cannot reach the owner's deal, its proposals or its history at all", async () => {
    const s = await setup();
    await expect(dealService.getDeal(s.otherSales, s.openDeal.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(proposalService.listProposalReferences(s.otherSales, s.openDeal.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("masked deals say so: value null, valueMasked true", async () => {
    const s = await setup();
    const deal = await dealService.getDeal(s.delivery, s.wonDeal.id);
    expect(deal.value).toBeNull();
    expect(deal.valueMasked).toBe(true);
    const mine = await dealService.getDeal(s.owner, s.openDeal.id);
    expect(mine.valueMasked).toBe(false);
  });
});

describe("masking helpers (FIG-1036, B2.07)", () => {
  const ctxWith = (membershipId: string, permissionKeys: string[]) => ({ membershipId, permissionKeys }) as unknown as AuthContext;

  it("margin is Management only, even for the owner; value follows ownership or deals.view.value", () => {
    const owner = ctxWith("m1", ["deals.view.own"]);
    const finance = ctxWith("m2", ["deals.view.value"]);
    const management = ctxWith("m3", ["deals.view.value", "deals.margin"]);
    const deal = { ownerMembershipId: "m1", value: 100, margin: 40 };

    expect(maskDeal(owner, deal)).toMatchObject({ value: 100, margin: null, marginMasked: true, valueMasked: false });
    expect(maskDeal(finance, deal)).toMatchObject({ value: 100, margin: null, marginMasked: true, valueMasked: false });
    expect(maskDeal(management, deal)).toMatchObject({ value: 100, margin: 40, valueMasked: false });
    expect(maskDeal(ctxWith("m9", []), deal)).toMatchObject({ value: null, margin: null, valueMasked: true });
  });

  it("redacts audit snapshots of money entities, but only for roles that may not see them", () => {
    const snapshot = { value: 100, currency: "KES", note: "kept", nested: { amount: 5, cost: 2 } };
    const plain = ctxWith("m1", []);
    const finance = ctxWith("m2", ["deals.view.value"]);
    expect(maskAuditSnapshot(plain, "Deal", snapshot)).toEqual({ value: null, currency: "KES", note: "kept", nested: { amount: null, cost: null } });
    expect(maskAuditSnapshot(finance, "Deal", snapshot)).toEqual({ value: 100, currency: "KES", note: "kept", nested: { amount: 5, cost: null } });
    // Entities that carry no money are left alone.
    expect(maskAuditSnapshot(plain, "Lead", snapshot)).toBe(snapshot);
  });

  it("redacts money in system-written text for roles that may not see values", () => {
    const cases = [
      "Deal won: KES 1,200,000 for Sentinel",
      "Quote total $4,500.50 approved",
      "Ksh 85,000 outstanding",
      "worth 250,000 KES",
      "Worth USD 12k this quarter",
    ];
    for (const text of cases) {
      expect(redactMoneyText(text)).not.toMatch(/\d{2,}/);
      expect(redactMoneyText(text)).toContain("[value hidden]");
    }
    expect(redactMoneyText("3 tasks are due, call 0712 345 678")).toBe("3 tasks are due, call 0712 345 678");
    expect(textForViewer(ctxWith("m", ["deals.view.value"]), cases[0]!)).toBe(cases[0]);
    expect(textForViewer(ctxWith("m", []), cases[0]!)).toBe("Deal won: [value hidden] for Sentinel");
  });
});
