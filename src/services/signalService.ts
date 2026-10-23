import type { Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { hasPermission } from "../auth/context";
import { adminDb } from "../db/adminClient";
import { logger } from "../lib/logger";
import { countDealsByOwner } from "../repositories/deals";
import {
  countActiveMembers,
  markSnapshotStale,
  pageUsageBetween,
  readSnapshot,
  writeSnapshot,
} from "../repositories/signals";
import { countTasksByAssignee } from "../repositories/tasks";
import { inactiveStageCutoffs, loadStageRules } from "./dealRuleService";

/**
 * Dashboard signals (FIG-1043, B2.14): adoption, stalled deals, deals past their
 * close date, and overdue tasks. They are computed once per organisation and
 * stored, and every dashboard and list header reads the stored values.
 *
 * Each number comes from the same filters the lists use (`inactiveStages`,
 * `closeDatePassed`, `overdueOnly`), so a count on the dashboard equals what
 * opening the list shows.
 *
 * Fresh when: the nightly job `signals.refresh` runs; a read finds the values
 * older than `SIGNALS_MAX_AGE_MS`; or a deal or task changed (the values are marked
 * stale and the next read recomputes).
 */

export const SIGNALS_MAX_AGE_MS = 10 * 60_000;
const WEEKS = 4;
const WEEK_MS = 7 * 24 * 60 * 60_000;

interface OwnerCount {
  total: number;
  byOwner: Record<string, number>;
}

export interface SignalSnapshotValue {
  computedAt: string;
  stalledDeals: OwnerCount;
  closeDatePassed: OwnerCount;
  overdueTasks: OwnerCount;
  adoption: {
    activeMembers: number;
    /** Rolling weeks ending at `computedAt`; index 0 is the latest. */
    weeks: { from: string; to: string; activeUsers: number; pagesUsed: number; views: number }[];
    /** People active in the latest week over active members, 0 to 1. */
    rate: number;
  };
}

function sum(rows: { key: string | null; count: number }[]): OwnerCount {
  const byOwner: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    total += r.count;
    if (r.key) byOwner[r.key] = (byOwner[r.key] ?? 0) + r.count;
  }
  return { total, byOwner };
}

/** Recomputes and stores the signals for one organisation. `now` is a seam for fixed-clock tests. */
export async function refreshSignals(organizationId: string, now = new Date()): Promise<SignalSnapshotValue> {
  const rules = await loadStageRules(organizationId);
  const openStages = await adminDb.pipelineStage.findMany({ where: { organizationId, isWon: false, isLost: false }, select: { id: true } });
  const cutoffs = inactiveStageCutoffs(
    openStages.map((s) => s.id),
    rules,
    now,
  );

  const [stalled, passed, overdue, activeMembers] = await Promise.all([
    countDealsByOwner(organizationId, { inactiveStages: cutoffs }),
    countDealsByOwner(organizationId, { closeDatePassed: true }),
    countTasksByAssignee(organizationId, { overdueOnly: true }),
    countActiveMembers(organizationId),
  ]);

  const weeks = [];
  for (let i = 0; i < WEEKS; i += 1) {
    const to = new Date(now.getTime() - i * WEEK_MS);
    const from = new Date(to.getTime() - WEEK_MS);
    weeks.push({ from: from.toISOString(), to: to.toISOString(), ...(await pageUsageBetween(organizationId, from, to)) });
  }
  const value: SignalSnapshotValue = {
    computedAt: now.toISOString(),
    stalledDeals: sum(stalled.map((r) => ({ key: r.ownerMembershipId, count: r.count }))),
    closeDatePassed: sum(passed.map((r) => ({ key: r.ownerMembershipId, count: r.count }))),
    overdueTasks: sum(overdue.map((r) => ({ key: r.assigneeMembershipId, count: r.count }))),
    adoption: {
      activeMembers,
      weeks,
      rate: activeMembers > 0 ? Math.round(((weeks[0]?.activeUsers ?? 0) / activeMembers) * 100) / 100 : 0,
    },
  };
  await writeSnapshot(organizationId, value as unknown as Prisma.InputJsonValue, now);
  return value;
}

/** The stored signals, recomputed first when they are older than ten minutes or were marked stale. */
export async function loadSignals(organizationId: string, now = new Date()): Promise<SignalSnapshotValue> {
  const row = await readSnapshot(organizationId);
  if (row && now.getTime() - row.computedAt.getTime() < SIGNALS_MAX_AGE_MS) return row.value as unknown as SignalSnapshotValue;
  return refreshSignals(organizationId, now);
}

/** Called when a deal or task changes. Never fails the change itself. */
export async function invalidateSignals(organizationId: string): Promise<void> {
  try {
    await markSnapshotStale(organizationId);
  } catch (err) {
    logger.warn({ err, organizationId }, "Could not mark dashboard signals stale");
  }
}

function view(counts: OwnerCount, scope: "all" | "own", ctx: AuthContext, names: Map<string, string>) {
  if (scope === "own") return { scope, total: counts.byOwner[ctx.membershipId] ?? 0 };
  return {
    scope,
    total: counts.total,
    unassigned: counts.total - Object.values(counts.byOwner).reduce((a, b) => a + b, 0),
    byOwner: Object.entries(counts.byOwner)
      .map(([membershipId, count]) => ({ membershipId, name: names.get(membershipId) ?? null, count }))
      .sort((a, b) => b.count - a.count || a.membershipId.localeCompare(b.membershipId)),
  };
}

/**
 * The signals this caller may see. A section they have no access to is left out
 * of the answer, not shown empty: deals need deal access (won-only viewers get
 * none, since stalled applies to open deals), tasks need task access, and
 * adoption is for people who see organisation-wide reporting.
 */
export async function getSignals(ctx: AuthContext, now = new Date()) {
  const snapshot = await loadSignals(ctx.organizationId, now);
  const members = await adminDb.membership.findMany({ where: { organizationId: ctx.organizationId }, select: { id: true, user: { select: { name: true } } } });
  const names = new Map(members.map((m) => [m.id, m.user.name]));

  const out: {
    computedAt: string;
    stalledDeals?: ReturnType<typeof view>;
    closeDatePassed?: ReturnType<typeof view>;
    overdueTasks?: ReturnType<typeof view>;
    adoption?: SignalSnapshotValue["adoption"];
  } = { computedAt: snapshot.computedAt };

  const dealScope = hasPermission(ctx, "deals.view.all") ? "all" : hasPermission(ctx, "deals.view.own") ? "own" : null;
  if (dealScope) {
    out.stalledDeals = view(snapshot.stalledDeals, dealScope, ctx, names);
    out.closeDatePassed = view(snapshot.closeDatePassed, dealScope, ctx, names);
  }
  const taskScope = hasPermission(ctx, "tasks.view.all") ? "all" : hasPermission(ctx, "tasks.view.own") ? "own" : null;
  if (taskScope) out.overdueTasks = view(snapshot.overdueTasks, taskScope, ctx, names);
  if (hasPermission(ctx, "reporting.view.all")) out.adoption = snapshot.adoption;
  return out;
}
