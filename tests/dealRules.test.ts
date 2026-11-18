import { describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { ArchivedReadOnlyError, ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { buildErrorResponse } from "../src/lib/apiErrors";
import { DEFAULT_STALLED_DAYS, checkMove, dealSignals, type StageLike } from "../src/lib/dealRules";
import * as activityService from "../src/services/activityService";
import * as companyService from "../src/services/companyService";
import {
  checkDealMove,
  getBoard,
  getDealRules,
  inactiveStageCutoffs,
  loadStageRules,
  moveDeal,
  signalsForDeal,
  undoDealMove,
  updateDealRules,
} from "../src/services/dealRuleService";
import * as dealService from "../src/services/dealService";
import { createTestContext, createTestOrganization, getPipelineStageId } from "./helpers/fixtures";

const NOW = new Date("2026-10-23T12:00:00Z");
const D = 24 * 3_600_000;

describe("deal signals (FIG-1035)", () => {
  const base = { now: NOW, outcome: "OPEN" as const, lastActivityAt: new Date(NOW.getTime() - 3 * D), expectedCloseDate: null, stalledAfterDays: 10 };

  it("an open deal is stalled only after its threshold, and closed deals never are", () => {
    expect(dealSignals(base).stalled).toBe(false);
    expect(dealSignals({ ...base, lastActivityAt: new Date(NOW.getTime() - 10 * D) }).stalled).toBe(false); // exactly at the threshold
    expect(dealSignals({ ...base, lastActivityAt: new Date(NOW.getTime() - 10 * D - 1000) })).toMatchObject({ stalled: true, daysSinceActivity: 10 });
    expect(dealSignals({ ...base, outcome: "WON", lastActivityAt: new Date(NOW.getTime() - 99 * D) }).stalled).toBe(false);
    expect(dealSignals({ ...base, stalledAfterDays: 2 }).stalled).toBe(true);
  });

  it("the close date has passed only once the day is over; closed deals are not overdue", () => {
    const closing = (days: number) => new Date(NOW.getTime() + days * D);
    expect(dealSignals({ ...base, expectedCloseDate: closing(0) })).toMatchObject({ closeDatePassed: false, closeDateOverdueDays: 0 });
    expect(dealSignals({ ...base, expectedCloseDate: closing(5) }).closeDatePassed).toBe(false);
    expect(dealSignals({ ...base, expectedCloseDate: closing(-1) })).toMatchObject({ closeDatePassed: true, closeDateOverdueDays: 1 });
    expect(dealSignals({ ...base, expectedCloseDate: closing(-9) }).closeDateOverdueDays).toBe(9);
    expect(dealSignals({ ...base, outcome: "LOST", expectedCloseDate: closing(-9) }).closeDatePassed).toBe(false);
  });
});

describe("move rules (FIG-1035)", () => {
  const stage = (over: Partial<StageLike> & { id: string; name: string }): StageLike => ({ isWon: false, isLost: false, isActive: true, ...over });
  const open = stage({ id: "s1", name: "Solution Presented" });
  const next = stage({ id: "s2", name: "Proposal Sent" });
  const won = stage({ id: "s4", name: "Closed Won", isWon: true });
  const lost = stage({ id: "s5", name: "Closed Lost", isLost: true });
  const ok = { fromOutcome: "OPEN" as const, archived: false, canEdit: true, canReopen: false, lostReasonId: null, lostReasonKnown: false };

  it("allows a plain move and reports each blocker with a code", () => {
    expect(checkMove({ ...ok, from: open, to: next })).toEqual([]);
    expect(checkMove({ ...ok, from: open, to: open })[0]).toMatchObject({ code: "SAME_STAGE" });
    expect(checkMove({ ...ok, from: open, to: null })[0]).toMatchObject({ code: "STAGE_NOT_FOUND" });
    expect(checkMove({ ...ok, from: open, to: stage({ id: "x", name: "Old", isActive: false }) })[0]).toMatchObject({ code: "STAGE_INACTIVE" });
    expect(checkMove({ ...ok, from: open, to: next, archived: true })[0]).toMatchObject({ code: "DEAL_ARCHIVED" });
    expect(checkMove({ ...ok, from: open, to: next, canEdit: false })[0]).toMatchObject({ code: "NOT_ALLOWED" });
  });

  it("Closed Lost needs a known lost reason; Closed Won needs none", () => {
    expect(checkMove({ ...ok, from: open, to: lost })[0]).toMatchObject({ code: "LOST_REASON_REQUIRED", field: "lostReasonId" });
    expect(checkMove({ ...ok, from: open, to: lost, lostReasonId: "r1", lostReasonKnown: false })[0]).toMatchObject({ code: "LOST_REASON_UNKNOWN" });
    expect(checkMove({ ...ok, from: open, to: lost, lostReasonId: "r1", lostReasonKnown: true })).toEqual([]);
    expect(checkMove({ ...ok, from: open, to: won })).toEqual([]);
  });

  it("only someone who may reopen can move a closed deal back to an open stage", () => {
    expect(checkMove({ ...ok, from: won, to: open, fromOutcome: "WON" })[0]).toMatchObject({ code: "REOPEN_NOT_ALLOWED" });
    expect(checkMove({ ...ok, from: lost, to: open, fromOutcome: "LOST", canReopen: true })).toEqual([]);
  });
});

async function setup() {
  const org = await createTestOrganization("DealRules");
  const management = await createTestContext(org.id, "MANAGEMENT");
  const owner = await createTestContext(org.id, "SALES", "owner");
  const other = await createTestContext(org.id, "SALES", "other");
  const delivery = await createTestContext(org.id, "DELIVERY");
  const finance = await createTestContext(org.id, "FINANCE");
  const technical = await createTestContext(org.id, "RESTRICTED_TECHNICAL");
  const stage = (key?: string) => getPipelineStageId(org.id, key);
  const { company } = await companyService.createCompany(management, { name: "Rules Co" });
  const newDeal = async (ctx = owner, value: number | undefined = 100000, extra: Record<string, unknown> = {}) =>
    dealService.createDeal(ctx, { companyId: company.id, pipelineStageId: await stage(), value, ...extra });
  const lostReason = await adminDb.lostReason.findFirstOrThrow({ where: { organizationId: org.id, key: "NO_BUDGET" } });
  return { org, management, owner, other, delivery, finance, technical, stage, company, newDeal, lostReason };
}

async function issuesOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ValidationError) return err.issues ?? [];
    throw err;
  }
  throw new Error("Expected the call to be rejected.");
}

describe("stalled thresholds and flags on deals (FIG-1035)", () => {
  it("defaults to ten days, can be set per stage and for the organisation, by Management only, with an audit entry", async () => {
    const { org, management, owner, stage } = await setup();
    const rules = await loadStageRules(org.id);
    expect(rules.defaultDays).toBe(DEFAULT_STALLED_DAYS);

    const proposalId = await stage("PROPOSAL_SENT");
    await expect(updateDealRules(owner, { defaultStalledDays: 5 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getDealRules(owner)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await issuesOf(updateDealRules(management, { defaultStalledDays: 0, stages: { nope: 3, [proposalId]: 400 } }))).map((i) => i.path).sort()).toEqual(["defaultStalledDays", "stages.nope", `stages.${proposalId}`].sort());

    const saved = await updateDealRules(management, { defaultStalledDays: 14, stages: { [proposalId]: 3 } });
    expect(saved.defaultStalledDays).toBe(14);
    expect(saved.stages.find((s) => s.id === proposalId)).toMatchObject({ stalledAfterDays: 3, effectiveDays: 3 });
    expect(saved.stages.find((s) => s.key === "NEGOTIATION")).toMatchObject({ stalledAfterDays: null, effectiveDays: 14 });
    // null goes back to the default.
    const cleared = await updateDealRules(management, { stages: { [proposalId]: null } });
    expect(cleared.stages.find((s) => s.id === proposalId)!.effectiveDays).toBe(14);
    expect(await adminDb.auditEvent.count({ where: { organizationId: org.id, action: "deal_rules.updated" } })).toBe(3 - 1);
  });

  it("flags a deal stalled when nothing has happened for longer than its stage allows; activity on the deal un-stalls it", async () => {
    const { org, management, owner, newDeal, stage } = await setup();
    const deal = await newDeal();
    const old = new Date(Date.now() - 12 * D);
    await adminDb.deal.update({ where: { id: deal.id }, data: { lastActivityAt: old } });

    const rules = await loadStageRules(org.id);
    const stalled = await dealService.getDeal(owner, deal.id);
    expect(signalsForDeal(stalled, rules)).toMatchObject({ stalled: true, stalledAfterDays: 10 });

    // A longer threshold for this stage means it is not stalled yet.
    await updateDealRules(management, { stages: { [await stage()]: 20 } });
    expect(signalsForDeal(stalled, await loadStageRules(org.id)).stalled).toBe(false);
    await updateDealRules(management, { stages: { [await stage()]: null } });

    await activityService.createActivity(owner, { type: "CALL", subject: "Checked in", dealId: deal.id });
    const fresh = await dealService.getDeal(owner, deal.id);
    expect(fresh.lastActivityAt.getTime()).toBeGreaterThan(old.getTime() + 11 * D);
    expect(signalsForDeal(fresh, await loadStageRules(org.id)).stalled).toBe(false);
  });

  it("lists can be filtered to stalled deals and to deals past their close date", async () => {
    const { org, owner, newDeal, stage } = await setup();
    const quiet = await newDeal();
    const busy = await newDeal();
    const late = await newDeal(owner, 5000, { expectedCloseDate: "2020-01-01" });
    const onTime = await newDeal(owner, 5000, { expectedCloseDate: "2099-01-01" });
    await adminDb.deal.update({ where: { id: quiet.id }, data: { lastActivityAt: new Date(Date.now() - 30 * D) } });
    void busy;

    const rules = await loadStageRules(org.id);
    const openStageIds = [await stage(), await stage("PROPOSAL_SENT"), await stage("NEGOTIATION")];
    const stalled = await dealService.listDeals(owner, { inactiveStages: inactiveStageCutoffs(openStageIds, rules) });
    expect(stalled.map((d) => d.id)).toEqual([quiet.id]);
    const passed = await dealService.listDeals(owner, { closeDatePassed: true });
    expect(passed.map((d) => d.id)).toEqual([late.id]);
    expect(passed.map((d) => d.id)).not.toContain(onTime.id);
  });
});

describe("moving deals (FIG-1035)", () => {
  it("a move to Closed Lost without a reason is rejected with a specific code; with a reason it goes through and is audited", async () => {
    const { org, owner, newDeal, stage, lostReason } = await setup();
    const deal = await newDeal();
    const lostId = await stage("CLOSED_LOST");

    const issues = await issuesOf(moveDeal(owner, deal.id, { pipelineStageId: lostId }));
    expect(issues).toEqual([expect.objectContaining({ code: "LOST_REASON_REQUIRED", path: "lostReasonId" })]);
    // The error envelope carries the code and the field for the Move to dialog.
    let thrown: unknown;
    try {
      await moveDeal(owner, deal.id, { pipelineStageId: lostId });
    } catch (err) {
      thrown = err;
    }
    const { status, body } = await buildErrorResponse(thrown, "req-test-0002");
    expect(status).toBe(400);
    expect(body.fieldErrors[0]).toMatchObject({ code: "LOST_REASON_REQUIRED", path: "lostReasonId" });
    expect((await dealService.getDeal(owner, deal.id)).outcome).toBe("OPEN");

    const moved = await moveDeal(owner, deal.id, { pipelineStageId: lostId, lostReasonId: lostReason.id });
    expect(moved.deal.outcome).toBe("LOST");
    const audit = await adminDb.auditEvent.findMany({ where: { organizationId: org.id, entityId: deal.id, action: "deal.moved" } });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.metadata).toMatchObject({ moveId: moved.move.id, lostReasonId: lostReason.id });
  });

  it("the Move to dialog can ask first: what is needed, and what blocks", async () => {
    const { owner, newDeal, stage } = await setup();
    const deal = await newDeal();
    expect(await checkDealMove(owner, deal.id, { pipelineStageId: await stage("CLOSED_LOST") })).toMatchObject({ allowed: false, needsLostReason: true, handoffPrompt: false });
    expect(await checkDealMove(owner, deal.id, { pipelineStageId: await stage("CLOSED_WON") })).toMatchObject({ allowed: true, handoffPrompt: true });
    expect(await checkDealMove(owner, deal.id, { pipelineStageId: await stage("PROPOSAL_SENT") })).toMatchObject({ allowed: true, needsLostReason: false, handoffPrompt: false, reopens: false });
    expect((await checkDealMove(owner, deal.id, { pipelineStageId: deal.pipelineStageId })).blockers[0]).toMatchObject({ code: "SAME_STAGE" });
  });

  it("scope and permissions: another salesperson cannot see it, Delivery cannot edit it, archived deals are read-only, an unknown stage is refused", async () => {
    const { management, owner, other, delivery, newDeal, stage } = await setup();
    const deal = await newDeal();
    const target = { pipelineStageId: await stage("PROPOSAL_SENT") };
    await expect(moveDeal(other, deal.id, target)).rejects.toBeInstanceOf(NotFoundError);

    // Delivery sees won deals only: an open deal does not exist for it.
    await expect(moveDeal(delivery, deal.id, target)).rejects.toBeInstanceOf(NotFoundError);

    expect((await issuesOf(moveDeal(owner, deal.id, { pipelineStageId: "00000000-0000-0000-0000-000000000000" })))[0]).toMatchObject({ code: "STAGE_NOT_FOUND" });
    await dealService.archiveDeal(management, deal.id);
    await expect(moveDeal(owner, deal.id, target)).rejects.toBeInstanceOf(ArchivedReadOnlyError);
  });

  it("only Management reopens a closed deal", async () => {
    const { org, management, owner, newDeal, stage, lostReason } = await setup();
    const deal = await newDeal();
    await moveDeal(owner, deal.id, { pipelineStageId: await stage("CLOSED_LOST"), lostReasonId: lostReason.id });
    const back = { pipelineStageId: await stage("NEGOTIATION") };
    expect((await issuesOf(moveDeal(owner, deal.id, back)))[0]).toMatchObject({ code: "REOPEN_NOT_ALLOWED" });
    const reopened = await moveDeal(management, deal.id, back);
    expect(reopened.deal.outcome).toBe("OPEN");
    void org;
  });

  it("moving to Closed Won hands the deal to Delivery, and that move cannot be undone", async () => {
    const { org, owner, delivery, newDeal, stage } = await setup();
    const deal = await newDeal();
    const moved = await moveDeal(owner, deal.id, { pipelineStageId: await stage("CLOSED_WON"), handoff: { deliveryOwnerMembershipId: delivery.membershipId } });
    expect(moved.deal.outcome).toBe("WON");
    expect(moved.move.undoable).toBe(false);
    expect(await adminDb.dealHandoff.count({ where: { dealId: deal.id } })).toBe(1);
    expect((await issuesOf(undoDealMove(owner, moved.move.id)))[0]).toMatchObject({ code: "MOVE_NOT_UNDOABLE" });
    void org;
  });

  it("a move can be undone for a few minutes, restoring the stage and outcome; later moves, old moves and repeats are refused", async () => {
    const { owner, newDeal, stage, lostReason } = await setup();
    const deal = await newDeal();
    const first = await moveDeal(owner, deal.id, { pipelineStageId: await stage("PROPOSAL_SENT") });
    const second = await moveDeal(owner, deal.id, { pipelineStageId: await stage("CLOSED_LOST"), lostReasonId: lostReason.id });

    await expect(undoDealMove(owner, first.move.id)).rejects.toThrow(/only the latest/);
    const restored = await undoDealMove(owner, second.move.id);
    expect(restored.pipelineStageId).toBe(await stage("PROPOSAL_SENT"));
    expect(restored).toMatchObject({ outcome: "OPEN", lostAt: null, lostReasonId: null });
    await expect(undoDealMove(owner, second.move.id)).rejects.toThrow(/already undone/);

    await adminDb.dealMove.update({ where: { id: first.move.id }, data: { undoExpiresAt: new Date(Date.now() - 1000) } });
    await expect(undoDealMove(owner, first.move.id)).rejects.toThrow(/time to undo/);
  });
});

describe("board columns (FIG-1035)", () => {
  it("counts per stage for everyone; values only for roles that may see them; a Delivery user gets no value at all", async () => {
    const { management, owner, other, delivery, finance, technical, newDeal, stage, org } = await setup();
    await newDeal(owner, 100000);
    await newDeal(owner, 50000);
    await newDeal(other, 25000);
    const won = await newDeal(management, 700000);
    await moveDeal(management, won.id, { pipelineStageId: await stage("CLOSED_WON"), handoff: { deliveryOwnerMembershipId: delivery.membershipId } });

    const asManagement = await getBoard(management);
    const first = asManagement.columns.find((c) => c.stage.key === "SOLUTION_PRESENTED")!;
    expect(first).toMatchObject({ count: 3, valuesHidden: false });
    expect(first.values).toEqual([{ currency: "KES", amount: 175000 }]);
    expect(asManagement.columns.find((c) => c.stage.key === "CLOSED_WON")).toMatchObject({ count: 1, values: [{ currency: "KES", amount: 700000 }] });

    // A salesperson sees their own deals only, with their values.
    const asOwner = await getBoard(owner);
    expect(asOwner.columns.find((c) => c.stage.key === "SOLUTION_PRESENTED")).toMatchObject({ count: 2, values: [{ currency: "KES", amount: 150000 }] });

    // Delivery sees won deals: counts, no values, and the key is not there to infer from.
    const asDelivery = await getBoard(delivery);
    const wonColumn = asDelivery.columns.find((c) => c.stage.key === "CLOSED_WON")!;
    expect(wonColumn).toMatchObject({ count: 1, valuesHidden: true });
    expect("values" in wonColumn).toBe(false);
    expect(asDelivery.columns.find((c) => c.stage.key === "SOLUTION_PRESENTED")!.count).toBe(0);
    const text = JSON.stringify(asDelivery);
    expect(text).not.toMatch(/700000|175000|150000/);

    // Finance sees won deals with values.
    expect((await getBoard(finance)).columns.find((c) => c.stage.key === "CLOSED_WON")).toMatchObject({ values: [{ currency: "KES", amount: 700000 }] });
    // Restricted Technical has no deals at all.
    await expect(getBoard(technical)).rejects.toBeInstanceOf(ForbiddenError);
    void org;
  });

  it("reports stalled and close-date-passed counts per column, and keeps organisations apart", async () => {
    const one = await setup();
    const two = await setup();
    const quiet = await one.newDeal();
    await one.newDeal(one.owner, 1000, { expectedCloseDate: "2020-01-01" });
    await adminDb.deal.update({ where: { id: quiet.id }, data: { lastActivityAt: new Date(Date.now() - 40 * D) } });

    const column = (await getBoard(one.management)).columns.find((c) => c.stage.key === "SOLUTION_PRESENTED")!;
    expect(column).toMatchObject({ count: 2, stalledCount: 1, closeDatePassedCount: 1 });
    expect((await getBoard(two.management)).columns.every((c) => c.count === 0)).toBe(true);
  });
});
