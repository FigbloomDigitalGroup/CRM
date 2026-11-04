import type { AuthContext } from "../auth/context";
import { deny, hasPermission, requirePermission } from "../auth/context";
import { ValidationError } from "../auth/errors";
import { canSeeAggregateValue } from "../auth/masking";
import {
  addMonths,
  monthKey,
  monthStartOf,
  parseMonth,
  stageProbability,
  targetProgress,
  weightedCents,
  type TargetState,
} from "../lib/forecast";
import { fromCents, toCents } from "../lib/payments";
import { recordAuditEvent } from "../repositories/auditEvents";
import { requireFeature } from "./featureService";
import {
  deleteTarget,
  listOpenDeals,
  listPipelineStages,
  listTargets,
  listWonDealsBetween,
  memberNamesById,
  upsertTarget,
} from "../repositories/forecast";

/**
 * Forecast and targets (FIG-1146, B6.14, design Q4). An estimate from stage probabilities, never a commitment.
 *
 *   scope "mine" : the caller's own open and won deals (needs deals.view.own or deals.edit.own, so Sales)
 *   scope "team" : every deal in the organisation (needs forecast.view.all)
 *   targets      : read by their owner and by forecast.view.all; written with targets.manage
 *
 * Masking (docs/MASKING.md): money follows the deal-value rule. A total over other people's deals is shown whole or not at all,
 * so a caller without deals.view.value asking for the team gets counts and `valueMasked: true`, never partial sums. A caller's
 * own deals always show their values. Documented in docs/FORECAST.md.
 */

export const MAX_HORIZON_MONTHS = 12;

export interface ForecastOptions {
  scope?: "mine" | "team";
  /** "YYYY-MM"; the first month of the buckets and the month the targets are for. Default: the current month. */
  month?: string;
  months?: number;
  now?: Date;
}

interface Totals {
  count: number;
  full: number;
  weighted: number;
}
const empty = (): Totals => ({ count: 0, full: 0, weighted: 0 });
const show = (t: Totals, visible: boolean) => ({ count: t.count, full: visible ? fromCents(t.full) : null, weighted: visible ? fromCents(t.weighted) : null });

const OWN_KEYS = ["deals.view.own", "deals.edit.own"];

function assertMayForecast(ctx: AuthContext, scope: "mine" | "team") {
  if (scope === "team") {
    if (!hasPermission(ctx, "forecast.view.all")) throw deny(ctx, "forecast.view.all", ["forecast.view.all"]);
    return;
  }
  if (!hasPermission(ctx, "forecast.view.all") && !OWN_KEYS.some((k) => hasPermission(ctx, k))) {
    throw deny(ctx, "forecast", ["forecast.view.all", "deals.view.own"]);
  }
}

function resolveMonth(month: string | undefined, now: Date): Date {
  if (month === undefined) return monthStartOf(now);
  const parsed = parseMonth(month);
  if (!parsed) throw new ValidationError("month must look like 2026-11.", [{ path: "month", message: "Use YYYY-MM." }]);
  return parsed;
}

export async function getForecast(ctx: AuthContext, options: ForecastOptions = {}) {
  const scope = options.scope ?? (hasPermission(ctx, "forecast.view.all") ? "team" : "mine");
  assertMayForecast(ctx, scope);
  await requireFeature(ctx.organizationId, "release.v11");
  const now = options.now ?? new Date();
  const start = resolveMonth(options.month, now);
  const horizon = options.months ?? 4;
  if (!Number.isInteger(horizon) || horizon < 1 || horizon > MAX_HORIZON_MONTHS) {
    throw new ValidationError(`months must be a whole number from 1 to ${MAX_HORIZON_MONTHS}.`, [{ path: "months", message: `1 to ${MAX_HORIZON_MONTHS}.` }]);
  }
  const end = addMonths(start, horizon);
  const nextMonth = addMonths(start, 1);
  const org = ctx.organizationId;
  const owner = scope === "mine" ? ctx.membershipId : undefined;
  // Values of other people's deals need deals.view.value; the team totals are whole or absent.
  const valuesVisible = scope === "mine" || canSeeAggregateValue(ctx);

  const [stages, openDeals, wonDeals, targets, members] = await Promise.all([
    listPipelineStages(org),
    listOpenDeals(org, owner),
    listWonDealsBetween(org, start, nextMonth, owner),
    listTargets(org, start, scope === "mine" ? ctx.membershipId : undefined),
    memberNamesById(org),
  ]);
  const stageById = new Map(stages.map((s) => [s.id, { ...s, ...stageProbability(s) }]));
  const names = new Map(members.map((m) => [m.id, m.user.name]));

  // Bucket every open deal exactly once: earlier, one of the months, later, or no close date.
  const bucketKeys = Array.from({ length: horizon }, (_, i) => monthKey(addMonths(start, i)));
  const months = new Map<string, Totals>(bucketKeys.map((k) => [k, empty()]));
  const earlier = empty();
  const later = empty();
  const unscheduled = empty();
  const total = empty();
  const byStage = new Map<string, Totals>();
  const inMonthWeighted = new Map<string, number>();
  const openByPerson = new Map<string, number>();

  for (const deal of openDeals) {
    const stage = stageById.get(deal.pipelineStageId);
    const percent = stage?.percent ?? 0;
    const cents = deal.value === null ? 0 : toCents(deal.value);
    const w = weightedCents(cents, percent);
    const add = (t: Totals) => {
      t.count += 1;
      t.full += cents;
      t.weighted += w;
    };
    add(total);
    const stageTotals = byStage.get(deal.pipelineStageId) ?? empty();
    add(stageTotals);
    byStage.set(deal.pipelineStageId, stageTotals);
    const close = deal.expectedCloseDate;
    if (!close) add(unscheduled);
    else if (close < start) add(earlier);
    else if (close >= end) add(later);
    else add(months.get(monthKey(close))!);
    if (close && close >= start && close < nextMonth) {
      inMonthWeighted.set(deal.ownerMembershipId, (inMonthWeighted.get(deal.ownerMembershipId) ?? 0) + w);
    }
    openByPerson.set(deal.ownerMembershipId, (openByPerson.get(deal.ownerMembershipId) ?? 0) + 1);
  }

  const wonByPerson = new Map<string, { count: number; cents: number }>();
  const wonTotal = { count: 0, cents: 0 };
  for (const deal of wonDeals) {
    const cents = deal.value === null ? 0 : toCents(deal.value);
    const p = wonByPerson.get(deal.ownerMembershipId) ?? { count: 0, cents: 0 };
    p.count += 1;
    p.cents += cents;
    wonByPerson.set(deal.ownerMembershipId, p);
    wonTotal.count += 1;
    wonTotal.cents += cents;
  }

  // Targets: one row per person who has a target or owns deals counted this month; the team row from the team target, else the sum.
  const personTarget = new Map<string, number>();
  let teamTargetCents: number | null = null;
  for (const t of targets) {
    if (t.membershipId === null) teamTargetCents = toCents(t.amount);
    else personTarget.set(t.membershipId, toCents(t.amount));
  }
  const personIds = new Set<string>([...personTarget.keys(), ...wonByPerson.keys(), ...inMonthWeighted.keys()]);
  if (scope === "mine") {
    for (const id of [...personIds]) if (id !== ctx.membershipId) personIds.delete(id);
    personIds.add(ctx.membershipId);
  }
  const progressRow = (wonC: number, weightedC: number, targetC: number, visible: boolean) => {
    const p = targetProgress(wonC, weightedC, targetC);
    return {
      state: (visible || p.state === "no-target" ? p.state : "masked") as TargetState | "masked",
      target: p.targetCents ? fromCents(p.targetCents) : null,
      won: visible ? fromCents(p.wonCents) : null,
      weighted: visible ? fromCents(p.weightedCents) : null,
      forecast: visible ? fromCents(p.forecastCents) : null,
      shortBy: visible ? fromCents(p.shortByCents) : null,
      attainmentPercent: visible ? p.attainmentPercent : null,
    };
  };
  const people = [...personIds]
    .map((id) => {
      // A person's figures are their own deals: visible to them, and to anyone who may see aggregate values.
      const visible = id === ctx.membershipId || canSeeAggregateValue(ctx);
      return {
        membershipId: id,
        name: names.get(id) ?? "Former member",
        openDeals: openByPerson.get(id) ?? 0,
        wonDeals: wonByPerson.get(id)?.count ?? 0,
        ...progressRow(wonByPerson.get(id)?.cents ?? 0, inMonthWeighted.get(id) ?? 0, personTarget.get(id) ?? 0, visible),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  let team = null;
  if (scope === "team") {
    const sum = [...personTarget.values()].reduce((a, b) => a + b, 0);
    const targetC = teamTargetCents ?? sum;
    const weightedInMonth = [...inMonthWeighted.values()].reduce((a, b) => a + b, 0);
    team = {
      targetSource: teamTargetCents !== null ? "team" : personTarget.size > 0 ? "sum-of-people" : "none",
      ...progressRow(wonTotal.cents, weightedInMonth, targetC, valuesVisible),
    };
  }

  return {
    scope,
    month: monthKey(start),
    months: horizon,
    asOf: now.toISOString(),
    currency: "KES",
    valueMasked: !valuesVisible,
    stages: stages
      .filter((s) => !s.isWon && !s.isLost && s.isActive)
      .map((s) => {
        const p = stageById.get(s.id)!;
        return { id: s.id, key: s.key, name: s.name, probability: p.percent, probabilitySet: p.isSet, ...show(byStage.get(s.id) ?? empty(), valuesVisible) };
      }),
    pipeline: show(total, valuesVisible),
    buckets: bucketKeys.map((k) => ({ month: k, ...show(months.get(k)!, valuesVisible) })),
    earlier: show(earlier, valuesVisible),
    later: show(later, valuesVisible),
    unscheduled: show(unscheduled, valuesVisible),
    won: { count: wonTotal.count, total: valuesVisible ? fromCents(wonTotal.cents) : null },
    people,
    team,
  };
}

// ---- Targets ---------------------------------------------------------------------------------------------------------------------------

export async function listMonthTargets(ctx: AuthContext, monthInput?: string, now: Date = new Date()) {
  const start = resolveMonth(monthInput, now);
  const all = hasPermission(ctx, "forecast.view.all") || hasPermission(ctx, "targets.manage");
  if (!all && !OWN_KEYS.some((k) => hasPermission(ctx, k))) throw deny(ctx, "forecast", ["forecast.view.all"]);
  await requireFeature(ctx.organizationId, "release.v11");
  const rows = await listTargets(ctx.organizationId, start, all ? undefined : ctx.membershipId);
  return {
    month: monthKey(start),
    items: rows.map((r) => ({ id: r.id, membershipId: r.membershipId, month: monthKey(r.periodStart), amount: fromCents(toCents(r.amount)), currency: r.currency })),
  };
}

export async function setTarget(ctx: AuthContext, input: { month: string; membershipId: string | null; amount: number | string | null }) {
  requirePermission(ctx, "targets.manage");
  await requireFeature(ctx.organizationId, "release.v11");
  const start = parseMonth(input.month);
  if (!start) throw new ValidationError("month must look like 2026-11.", [{ path: "month", message: "Use YYYY-MM." }]);
  if (input.membershipId !== null) {
    const members = await memberNamesById(ctx.organizationId);
    const member = members.find((m) => m.id === input.membershipId);
    if (!member || member.status !== "ACTIVE") {
      throw new ValidationError("That person is not an active member of this organisation.", [{ path: "membershipId", message: "Pick an active member." }]);
    }
  }
  if (input.amount === null) {
    const removed = await deleteTarget(ctx.organizationId, input.membershipId, start);
    if (removed) {
      await recordAuditEvent({
        organizationId: ctx.organizationId,
        actorMembershipId: ctx.membershipId,
        action: "sales_target.removed",
        entityType: "SalesTarget",
        entityId: removed.id,
        previousValue: { month: input.month, membershipId: input.membershipId },
      });
    }
    return { month: input.month, membershipId: input.membershipId, amount: null };
  }
  const n = Number(input.amount);
  if (!Number.isFinite(n) || n < 0 || n > 1e12) {
    throw new ValidationError("A target is an amount of 0 or more.", [{ path: "amount", message: "Enter 0 or more." }]);
  }
  const cents = Math.round(n * 100);
  const { before, after } = await upsertTarget({
    organizationId: ctx.organizationId,
    membershipId: input.membershipId,
    periodStart: start,
    amount: fromCents(cents),
    setBy: ctx.membershipId,
  });
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: before ? "sales_target.updated" : "sales_target.set",
    entityType: "SalesTarget",
    entityId: after.id,
    previousValue: before ? { amount: fromCents(toCents(before.amount)) } : undefined,
    newValue: { amount: fromCents(cents), month: input.month, membershipId: input.membershipId },
  });
  return { id: after.id, month: input.month, membershipId: input.membershipId, amount: fromCents(cents) };
}
