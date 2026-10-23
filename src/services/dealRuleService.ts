import type { PipelineStage } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { canActOnOwnedRecord, hasPermission, requirePermission } from "../auth/context";
import { NotFoundError, ValidationError, type ValidationIssue } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import {
  DEFAULT_STALLED_DAYS,
  MAX_STALLED_DAYS,
  MIN_STALLED_DAYS,
  MOVE_UNDO_WINDOW_MS,
  checkMove,
  dealSignals,
  type DealSignals,
  type MoveBlocker,
} from "../lib/dealRules";
import { assertWritable } from "../lib/archive";
import { recordAuditEvent } from "../repositories/auditEvents";
import { boardColumns, getDealById, updateDeal as updateDealRecord, type ListDealsFilters } from "../repositories/deals";
import { createDealMove, getDealMove, latestOpenMove, markMoveUndone } from "../repositories/dealMoves";
import { getDeal, listDeals, updateDeal } from "./dealService";

/**
 * Deal rules (FIG-1035, B2.06). Stalled thresholds per stage with an
 * organisation default, the close-date-passed flag, move validation with a
 * reason the Move to dialog can show, board column aggregates that respect
 * value masking, and undo of a move within a short window. The pipeline never
 * moves a deal by itself; only a person does, through `moveDeal`.
 */

export const STALLED_DEFAULT_KEY = "deal_rules.stalled_days";

export interface StageRules {
  defaultDays: number;
  byStage: Map<string, number | null>;
  /** Effective days for a stage: its own, else the default. */
  daysFor(stageId: string): number;
}

export async function loadStageRules(organizationId: string): Promise<StageRules> {
  const [setting, stages] = await Promise.all([
    adminDb.organizationSetting.findUnique({ where: { organizationId_key: { organizationId, key: STALLED_DEFAULT_KEY } } }),
    adminDb.pipelineStage.findMany({ where: { organizationId }, select: { id: true, stalledAfterDays: true } }),
  ]);
  const raw = (setting?.value as { days?: unknown } | null)?.days;
  const defaultDays = typeof raw === "number" && raw >= MIN_STALLED_DAYS && raw <= MAX_STALLED_DAYS ? raw : DEFAULT_STALLED_DAYS;
  const byStage = new Map(stages.map((s) => [s.id, s.stalledAfterDays]));
  return { defaultDays, byStage, daysFor: (id) => byStage.get(id) ?? defaultDays };
}

/** The signals for one deal row: stalled, close date passed, and how long. */
export function signalsForDeal(
  deal: { outcome: "OPEN" | "WON" | "LOST"; pipelineStageId: string; lastActivityAt: Date; expectedCloseDate: Date | null },
  rules: StageRules,
  now = new Date(),
): DealSignals {
  return dealSignals({
    now,
    outcome: deal.outcome,
    lastActivityAt: deal.lastActivityAt,
    expectedCloseDate: deal.expectedCloseDate,
    stalledAfterDays: rules.daysFor(deal.pipelineStageId),
  });
}

/** For the list filter "stalled": each stage with the moment before which its deals count as inactive. */
export function inactiveStageCutoffs(stageIds: string[], rules: StageRules, now = new Date()) {
  return stageIds.map((stageId) => ({ stageId, before: new Date(now.getTime() - rules.daysFor(stageId) * 24 * 60 * 60 * 1000) }));
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getDealRules(ctx: AuthContext) {
  requirePermission(ctx, "configuration.manage");
  const rules = await loadStageRules(ctx.organizationId);
  const stages = await adminDb.pipelineStage.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { sequence: "asc" } });
  return {
    defaultStalledDays: rules.defaultDays,
    stages: stages.map((s) => ({ id: s.id, key: s.key, name: s.name, isWon: s.isWon, isLost: s.isLost, stalledAfterDays: s.stalledAfterDays, effectiveDays: rules.daysFor(s.id) })),
    min: MIN_STALLED_DAYS,
    max: MAX_STALLED_DAYS,
  };
}

/** Management sets the default and per-stage thresholds (days, or null to use the default). */
export async function updateDealRules(ctx: AuthContext, input: { defaultStalledDays?: number; stages?: Record<string, number | null> }) {
  requirePermission(ctx, "configuration.manage");
  const issues: ValidationIssue[] = [];
  const valid = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= MIN_STALLED_DAYS && n <= MAX_STALLED_DAYS;
  if (input.defaultStalledDays !== undefined && !valid(input.defaultStalledDays)) {
    issues.push({ path: "defaultStalledDays", message: `Use a whole number of days from ${MIN_STALLED_DAYS} to ${MAX_STALLED_DAYS}.` });
  }
  const stageIds = Object.keys(input.stages ?? {});
  const known = new Set((await adminDb.pipelineStage.findMany({ where: { organizationId: ctx.organizationId, id: { in: stageIds } }, select: { id: true } })).map((s) => s.id));
  for (const [id, days] of Object.entries(input.stages ?? {})) {
    if (!known.has(id)) issues.push({ path: `stages.${id}`, message: "Unknown pipeline stage." });
    else if (days !== null && !valid(days)) issues.push({ path: `stages.${id}`, message: `Use a whole number of days from ${MIN_STALLED_DAYS} to ${MAX_STALLED_DAYS}, or null for the default.` });
  }
  if (issues.length > 0) throw new ValidationError("These deal rules are not valid.", issues);

  const before = await getDealRules(ctx);
  if (input.defaultStalledDays !== undefined) {
    await adminDb.organizationSetting.upsert({
      where: { organizationId_key: { organizationId: ctx.organizationId, key: STALLED_DEFAULT_KEY } },
      update: { value: { days: input.defaultStalledDays } },
      create: { organizationId: ctx.organizationId, key: STALLED_DEFAULT_KEY, value: { days: input.defaultStalledDays } },
    });
  }
  for (const [id, days] of Object.entries(input.stages ?? {})) {
    await adminDb.pipelineStage.update({ where: { id, organizationId: ctx.organizationId }, data: { stalledAfterDays: days } });
  }
  const after = await getDealRules(ctx);
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "deal_rules.updated",
    entityType: "Organization",
    entityId: ctx.organizationId,
    previousValue: { defaultStalledDays: before.defaultStalledDays, stages: Object.fromEntries(before.stages.map((s) => [s.key, s.stalledAfterDays])) },
    newValue: { defaultStalledDays: after.defaultStalledDays, stages: Object.fromEntries(after.stages.map((s) => [s.key, s.stalledAfterDays])) },
  });
  return after;
}

// ---------------------------------------------------------------------------
// Moving a deal
// ---------------------------------------------------------------------------

export interface MoveInput {
  pipelineStageId: string;
  lostReasonId?: string | null;
  handoff?: { deliveryOwnerMembershipId?: string };
}

export interface MoveCheck {
  allowed: boolean;
  blockers: MoveBlocker[];
  /** Moving to Closed Lost needs a lost reason. */
  needsLostReason: boolean;
  /** Moving to Closed Won opens the handoff to Delivery (B2.08): the dialog asks who receives it. */
  handoffPrompt: boolean;
  /** Moving a closed deal back to an open stage. */
  reopens: boolean;
}

async function evaluateMove(ctx: AuthContext, dealId: string, input: MoveInput) {
  const deal = await getDeal(ctx, dealId);
  const [stages, lostReason] = await Promise.all([
    adminDb.pipelineStage.findMany({ where: { organizationId: ctx.organizationId, id: { in: [deal.pipelineStageId, input.pipelineStageId] } } }),
    input.lostReasonId ? adminDb.lostReason.findFirst({ where: { id: input.lostReasonId, organizationId: ctx.organizationId }, select: { id: true } }) : Promise.resolve(null),
  ]);
  const from = stages.find((s) => s.id === deal.pipelineStageId) as PipelineStage;
  const to = stages.find((s) => s.id === input.pipelineStageId) ?? null;
  const canEdit = canActOnOwnedRecord(ctx, "deals.edit.own", "deals.edit.all", deal.ownerMembershipId);
  const blockers = checkMove({
    from,
    to,
    fromOutcome: deal.outcome,
    archived: deal.archivedAt !== null,
    canEdit,
    canReopen: hasPermission(ctx, "deals.edit.all"),
    lostReasonId: input.lostReasonId,
    lostReasonKnown: lostReason !== null,
  });
  const check: MoveCheck = {
    allowed: blockers.length === 0,
    blockers,
    needsLostReason: to?.isLost === true,
    handoffPrompt: to?.isWon === true && deal.outcome !== "WON",
    reopens: deal.outcome !== "OPEN" && to !== null && !to.isWon && !to.isLost,
  };
  return { deal, from, to, check };
}

/** What would block this move, and what the Move to dialog must ask for. Changes nothing. */
export async function checkDealMove(ctx: AuthContext, dealId: string, input: MoveInput): Promise<MoveCheck> {
  return (await evaluateMove(ctx, dealId, input)).check;
}

/** Moves a deal to another stage after checking the rules; records the move so it can be undone for a few minutes. */
export async function moveDeal(ctx: AuthContext, dealId: string, input: MoveInput) {
  const { deal, from, to, check } = await evaluateMove(ctx, dealId, input);
  if (!check.allowed) {
    const first = check.blockers[0]!;
    if (first.code === "NOT_ALLOWED") {
      requireEdit(ctx, deal.ownerMembershipId);
    }
    if (first.code === "DEAL_ARCHIVED") assertWritable(ctx, "deal", deal, "moving it");
    throw new ValidationError(first.message, check.blockers.map((b) => ({ path: b.field ?? "pipelineStageId", message: b.message, code: b.code })));
  }

  const previous = { outcome: deal.outcome, wonAt: deal.wonAt, lostAt: deal.lostAt, lostReasonId: deal.lostReasonId };
  const updated = await updateDeal(ctx, dealId, {
    pipelineStageId: input.pipelineStageId,
    lostReasonId: input.lostReasonId,
    handoff: input.handoff,
  });
  const move = await createDealMove({
    organizationId: ctx.organizationId,
    dealId,
    fromStageId: from.id,
    toStageId: to!.id,
    movedByMembershipId: ctx.membershipId,
    undoExpiresAt: new Date(Date.now() + MOVE_UNDO_WINDOW_MS),
    previous: JSON.parse(JSON.stringify(previous)),
  });
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "deal.moved",
    entityType: "Deal",
    entityId: dealId,
    previousValue: { stage: from.name, outcome: deal.outcome },
    newValue: { stage: to!.name, outcome: updated.outcome },
    metadata: { moveId: move.id, lostReasonId: input.lostReasonId ?? null },
  });
  return { deal: updated, move: { id: move.id, undoExpiresAt: move.undoExpiresAt, undoable: !to!.isWon } };
}

function requireEdit(ctx: AuthContext, ownerMembershipId: string) {
  // Throws the explained "no access" for someone who may view but not edit this deal.
  if (!canActOnOwnedRecord(ctx, "deals.edit.own", "deals.edit.all", ownerMembershipId)) {
    requirePermission(ctx, "deals.edit.all");
  }
}

/**
 * Puts a deal back where it was before the move, for a few minutes after it.
 * A move to Closed Won opens a handoff to Delivery, so it cannot be undone here;
 * Management reopens a won deal instead.
 */
export async function undoDealMove(ctx: AuthContext, moveId: string) {
  const move = await getDealMove(ctx.organizationId, moveId);
  if (!move) throw new NotFoundError("DealMove", moveId);
  const deal = await getDealById(ctx.organizationId, move.dealId);
  if (!deal) throw new NotFoundError("Deal", move.dealId);
  // The caller must be able to open and edit the deal.
  await getDeal(ctx, move.dealId);
  requireEdit(ctx, deal.ownerMembershipId);
  assertWritable(ctx, "deal", deal, "undoing the move");

  if (move.undoneAt) throw new ValidationError("This move was already undone.");
  if (move.undoExpiresAt.getTime() < Date.now()) throw new ValidationError("The time to undo this move has passed.");
  const latest = await latestOpenMove(ctx.organizationId, move.dealId);
  if (!latest || latest.id !== move.id || deal.pipelineStageId !== move.toStageId) {
    throw new ValidationError("The deal has moved again since; only the latest move can be undone.");
  }
  const target = await adminDb.pipelineStage.findFirst({ where: { id: move.toStageId, organizationId: ctx.organizationId } });
  if (target?.isWon) {
    throw new ValidationError("A deal moved to Closed Won has been handed to Delivery, so the move cannot be undone. Ask Management to reopen it.", [{ path: "moveId", message: "Won moves are not undoable.", code: "MOVE_NOT_UNDOABLE" }]);
  }

  const previous = move.previous as { outcome: "OPEN" | "WON" | "LOST"; wonAt: string | null; lostAt: string | null; lostReasonId: string | null };
  if (!(await markMoveUndone(ctx.organizationId, moveId))) throw new ValidationError("This move was already undone.");
  const restored = await updateDealRecord(ctx.organizationId, move.dealId, {
    pipelineStageId: move.fromStageId,
    outcome: previous.outcome,
    wonAt: previous.wonAt ? new Date(previous.wonAt) : null,
    lostAt: previous.lostAt ? new Date(previous.lostAt) : null,
    lostReasonId: previous.lostReasonId,
  });
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "deal.move_undone",
    entityType: "Deal",
    entityId: move.dealId,
    metadata: { moveId, fromStageId: move.toStageId, toStageId: move.fromStageId },
  });
  return restored;
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

export interface BoardColumn {
  stage: { id: string; key: string; name: string; sequence: number; isWon: boolean; isLost: boolean };
  count: number;
  stalledCount: number;
  closeDatePassedCount: number;
  /** Value per currency; absent when the caller may not see the values of every deal in the column. */
  values?: { currency: string; amount: number }[];
  /** True when values were left out. */
  valuesHidden: boolean;
}

/**
 * Column counts and values for the deals board. Values appear only when the
 * caller may see every deal's value (`deals.view.value`, or the scope is their
 * own deals); otherwise the key is left out entirely, so there is nothing to
 * infer from. Counts are always shown.
 */
export async function getBoard(ctx: AuthContext, filters: ListDealsFilters = {}) {
  // Reuses the list service's scoping by asking it for the filters it would apply.
  const scoped = await scopeFor(ctx, filters);
  const [stages, rules, columns] = await Promise.all([
    adminDb.pipelineStage.findMany({ where: { organizationId: ctx.organizationId, isActive: true }, orderBy: { sequence: "asc" } }),
    loadStageRules(ctx.organizationId),
    boardColumns(ctx.organizationId, { ...scoped.filters, outcome: undefined }),
  ]);
  const showValues = hasPermission(ctx, "deals.view.value") || scoped.ownDealsOnly;

  const now = new Date();
  const result: BoardColumn[] = [];
  for (const stage of stages) {
    const rows = columns.rows.filter((r) => r.pipelineStageId === stage.id);
    const count = rows.reduce((n, r) => n + r._count._all, 0);
    const [stalled, passed] = await Promise.all([
      stage.isWon || stage.isLost ? 0 : (await listDealsCount(ctx, { ...filters, pipelineStageId: stage.id, inactiveStages: inactiveStageCutoffs([stage.id], rules, now) })),
      stage.isWon || stage.isLost ? 0 : (await listDealsCount(ctx, { ...filters, pipelineStageId: stage.id, closeDatePassed: true })),
    ]);
    const column: BoardColumn = {
      stage: { id: stage.id, key: stage.key, name: stage.name, sequence: stage.sequence, isWon: stage.isWon, isLost: stage.isLost },
      count,
      stalledCount: stalled,
      closeDatePassedCount: passed,
      valuesHidden: !showValues,
    };
    if (showValues) {
      column.values = rows
        .filter((r) => r._sum.value !== null)
        .map((r) => ({ currency: r.currency, amount: Number(r._sum.value) }))
        .sort((a, b) => a.currency.localeCompare(b.currency));
    }
    result.push(column);
  }
  return { columns: result, defaultStalledDays: rules.defaultDays };
}

/** The caller's scope for deals: the filters the list service applies, and whether every visible deal is their own. */
async function scopeFor(ctx: AuthContext, filters: ListDealsFilters) {
  if (hasPermission(ctx, "deals.view.all")) return { filters, ownDealsOnly: false };
  if (hasPermission(ctx, "deals.view.own")) return { filters: { ...filters, ownerMembershipId: ctx.membershipId }, ownDealsOnly: true };
  if (hasPermission(ctx, "deals.view.won")) return { filters: { ...filters, visibleOutcome: "WON" as const }, ownDealsOnly: false };
  requirePermission(ctx, "deals.view.all");
  return { filters, ownDealsOnly: false };
}

async function listDealsCount(ctx: AuthContext, filters: ListDealsFilters) {
  const { countDeals } = await import("./dealService");
  return countDeals(ctx, filters);
}

export { listDeals };
