import { describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { ValidationError } from "../src/auth/errors";
import { checkDealMove, updateDealChecked } from "../src/services/dealRuleService";
import { decideApproval, requestDealMoveApproval, updateApprovalRules } from "../src/services/approvalService";
import { listPipelines, setStageRules } from "../src/services/pipelineService";
import * as dealService from "../src/services/dealService";
import * as leadService from "../src/services/leadService";
import { createCompany } from "../src/services/companyService";
import { DEFAULT_APPROVAL_RULES, largeDealNeedsApproval } from "../src/lib/approvalRules";
import { commercialWorld, stageIdFor } from "./commercialFixtures";
import { createTestContext, createTestOrganization, getLeadStatusId } from "./helpers/fixtures";

async function issuesOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ValidationError) return err.issues ?? [];
    throw err;
  }
  throw new Error("Expected the call to be rejected.");
}

async function world() {
  const w = await commercialWorld();
  const managementTwo = await createTestContext(w.org.id, "MANAGEMENT");
  const def = (await listPipelines(w.management)).items[0]!;
  const stage = (key: string) => def.stages.find((s) => s.key === key)!;
  await updateApprovalRules(w.management, { largeDeal: { enabled: true, thresholdAmount: 100000 } });
  return { ...w, managementTwo, def, stage };
}

const setArchived = (dealId: string, on: boolean) => adminDb.deal.update({ where: { id: dealId }, data: { archivedAt: on ? new Date() : null } });

describe("review finding 1: PATCH /deals and lead conversion cannot skip the stage gates", () => {
  it("PATCH to a gated stage is blocked with the move codes, and nothing moves", async () => {
    const w = await world();
    const proposal = w.stage("PROPOSAL_SENT");
    await setStageRules(w.management, w.def.id, proposal.id, [{ type: "QUOTE_REQUIRED" }]);
    const codes = (await issuesOf(updateDealChecked(w.sales, w.deal.id, { pipelineStageId: proposal.id }))).map((i) => i.code);
    expect(codes).toEqual(["QUOTE_REQUIRED"]);
    expect((await adminDb.deal.findUniqueOrThrow({ where: { id: w.deal.id } })).pipelineStageId).toBe(w.stageId);
  });

  it("PATCH to Won needs the approval and PATCH to Lost needs a reason", async () => {
    const w = await world();
    const won = await stageIdFor(w.org.id, "CLOSED_WON");
    expect((await issuesOf(updateDealChecked(w.sales, w.deal.id, { pipelineStageId: won }))).map((i) => i.code)).toContain("APPROVAL_REQUIRED");
    const lost = await stageIdFor(w.org.id, "CLOSED_LOST");
    expect((await issuesOf(updateDealChecked(w.sales, w.deal.id, { pipelineStageId: lost }))).length).toBeGreaterThan(0);
    expect((await adminDb.deal.findUniqueOrThrow({ where: { id: w.deal.id } })).outcome).toBe("OPEN");
  });

  it("an allowed PATCH move leaves the same move record and audit event as /move, and saves the other fields with it", async () => {
    const w = await world();
    const negotiation = w.stage("NEGOTIATION");
    const out = await updateDealChecked(w.sales, w.deal.id, { pipelineStageId: negotiation.id, notes: "moved by patch" });
    expect(out).toMatchObject({ pipelineStageId: negotiation.id, notes: "moved by patch" });
    expect(await adminDb.dealMove.count({ where: { dealId: w.deal.id, toStageId: negotiation.id } })).toBe(1);
    expect(await adminDb.auditEvent.count({ where: { organizationId: w.org.id, entityId: w.deal.id, action: "deal.moved" } })).toBe(1);
  });

  it("the gate sees the value sent in the same PATCH", async () => {
    const w = await world();
    const small = await dealService.createDeal(w.sales, { companyId: w.company.id, pipelineStageId: w.stageId, value: 1000 });
    const won = await stageIdFor(w.org.id, "CLOSED_WON");
    expect((await issuesOf(updateDealChecked(w.sales, small.id, { pipelineStageId: won, value: 5_000_000 }))).map((i) => i.code)).toContain("APPROVAL_REQUIRED");
    expect((await adminDb.deal.findUniqueOrThrow({ where: { id: small.id } })).outcome).toBe("OPEN");
  });

  it("a deal cannot be created or converted straight into a gated, won or lost stage", async () => {
    const w = await world();
    const proposal = w.stage("PROPOSAL_SENT");
    await setStageRules(w.management, w.def.id, proposal.id, [{ type: "QUOTE_REQUIRED" }]);
    expect((await issuesOf(dealService.createDeal(w.sales, { companyId: w.company.id, pipelineStageId: proposal.id, value: 10 })))[0]).toMatchObject({ code: "STAGE_GATED" });
    const leadStatusId = await getLeadStatusId(w.org.id);
    const { lead } = await leadService.createLead(w.sales, { leadStatusId, companyId: w.company.id });
    expect((await issuesOf(leadService.convertLead(w.sales, lead.id, { pipelineStageId: proposal.id })))[0]).toMatchObject({ code: "STAGE_GATED" });
    const won = await stageIdFor(w.org.id, "CLOSED_WON");
    expect((await issuesOf(leadService.convertLead(w.sales, lead.id, { pipelineStageId: won })))[0]).toMatchObject({ code: "STAGE_NOT_OPEN" });
    // The refused attempts did not consume the lead; an ungated stage works.
    const deal = await leadService.convertLead(w.sales, lead.id, { pipelineStageId: w.stage("NEGOTIATION").id });
    expect(deal.pipelineStageId).toBe(w.stage("NEGOTIATION").id);
  });
});

describe("review finding 1: a V1 organisation behaves as before", () => {
  it("PATCH and convert reach any stage without gates, and no move record is written", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");
    const { company } = await createCompany(ctx, { name: "V1 Co" });
    const open = await stageIdFor(org.id, "SOLUTION_PRESENTED");
    const deal = await dealService.createDeal(ctx, { companyId: company.id, pipelineStageId: open, value: 10 });
    const negotiation = await stageIdFor(org.id, "NEGOTIATION");
    expect((await updateDealChecked(ctx, deal.id, { pipelineStageId: negotiation })).pipelineStageId).toBe(negotiation);
    expect(await adminDb.dealMove.count({ where: { dealId: deal.id } })).toBe(0);
    const leadStatusId = await getLeadStatusId(org.id);
    const { lead } = await leadService.createLead(ctx, { leadStatusId, companyId: company.id });
    expect((await leadService.convertLead(ctx, lead.id, { pipelineStageId: negotiation })).pipelineStageId).toBe(negotiation);
  });
});

describe("review finding 2: the large-deal rule cannot be skipped by changing the currency or clearing the value", () => {
  const rules = { ...DEFAULT_APPROVAL_RULES, largeDeal: { enabled: true, thresholdAmount: 100000, currency: "KES" } };

  it("needs approval for another currency, no value or a zero value, and not for a small KES deal", () => {
    expect(largeDealNeedsApproval(500000, "USD", rules)).toBe(true);
    expect(largeDealNeedsApproval(null, "KES", rules)).toBe(true);
    expect(largeDealNeedsApproval(0, "KES", rules)).toBe(true);
    expect(largeDealNeedsApproval(50000, "KES", rules)).toBe(false);
    expect(largeDealNeedsApproval(500000, "KES", rules)).toBe(true);
    expect(largeDealNeedsApproval(null, "USD", { ...rules, largeDeal: { ...rules.largeDeal, enabled: false } })).toBe(false);
  });

  it("an owner who switches the currency or clears the value still meets the approval gate on Won", async () => {
    const w = await world();
    const won = await stageIdFor(w.org.id, "CLOSED_WON");
    await dealService.updateDeal(w.sales, w.deal.id, { currency: "USD" });
    expect((await issuesOf(updateDealChecked(w.sales, w.deal.id, { pipelineStageId: won }))).map((i) => i.code)).toContain("APPROVAL_REQUIRED");
    await dealService.updateDeal(w.sales, w.deal.id, { currency: "KES", value: null });
    expect((await issuesOf(updateDealChecked(w.sales, w.deal.id, { pipelineStageId: won }))).map((i) => i.code)).toContain("APPROVAL_REQUIRED");
    expect((await adminDb.deal.findUniqueOrThrow({ where: { id: w.deal.id } })).outcome).toBe("OPEN");
  });
});

describe("review finding 3: an approval is bound to the value and currency, and can be revoked", () => {
  it("an edit of the value after the request voids the grant", async () => {
    const w = await world();
    const won = await stageIdFor(w.org.id, "CLOSED_WON");
    const item = await requestDealMoveApproval(w.sales, w.deal.id, { pipelineStageId: won });
    expect(await adminDb.approvalRequest.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ grantCurrency: "KES" });
    await dealService.updateDeal(w.sales, w.deal.id, { value: 50_000_000 });
    const decided = await decideApproval(w.management, item.id, { approve: true });
    expect(decided).toMatchObject({ status: "APPROVED", resumed: false });
    expect(decided.resumeError).toBeTruthy();
    expect((await issuesOf(updateDealChecked(w.sales, w.deal.id, { pipelineStageId: won }))).map((i) => i.code)).toContain("APPROVAL_REQUIRED");
    expect((await adminDb.deal.findUniqueOrThrow({ where: { id: w.deal.id } })).outcome).toBe("OPEN");
  });

  it("a grant stops working after a currency change", async () => {
    const w = await world();
    const won = await stageIdFor(w.org.id, "CLOSED_WON");
    const asked = await requestDealMoveApproval(w.sales, w.deal.id, { pipelineStageId: won });
    await setArchived(w.deal.id, true); // the automatic move cannot run, so the approval stays a grant
    await decideApproval(w.management, asked.id, { approve: true });
    await setArchived(w.deal.id, false);
    expect((await checkDealMove(w.sales, w.deal.id, { pipelineStageId: won })).allowed).toBe(true);
    expect((await checkDealMove(w.management, w.deal.id, { pipelineStageId: won })).allowed).toBe(true);
    await adminDb.deal.update({ where: { id: w.deal.id }, data: { currency: "USD" } });
    expect((await checkDealMove(w.sales, w.deal.id, { pipelineStageId: won })).blockers.map((b) => b.code)).toContain("APPROVAL_REQUIRED");
  });

  it("an approver can revoke an approval that has not been used", async () => {
    const w = await world();
    const won = await stageIdFor(w.org.id, "CLOSED_WON");
    const asked = await requestDealMoveApproval(w.sales, w.deal.id, { pipelineStageId: won });
    await setArchived(w.deal.id, true);
    await decideApproval(w.management, asked.id, { approve: true });
    await setArchived(w.deal.id, false);
    expect((await checkDealMove(w.sales, w.deal.id, { pipelineStageId: won })).allowed).toBe(true);
    expect((await issuesOf(decideApproval(w.managementTwo, asked.id, { approve: false })))[0]).toMatchObject({ code: "REASON_REQUIRED" });
    const revoked = await decideApproval(w.managementTwo, asked.id, { approve: false, reason: "Contract changed" });
    expect(revoked.status).toBe("EXPIRED");
    expect((await checkDealMove(w.sales, w.deal.id, { pipelineStageId: won })).blockers.map((b) => b.code)).toContain("APPROVAL_REQUIRED");
    expect(await adminDb.auditEvent.count({ where: { organizationId: w.org.id, entityId: asked.id, action: "approval.revoked" } })).toBe(1);
  });
});
