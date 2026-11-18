import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { NotFoundError, ValidationError } from "../auth/errors";
import { cleanText } from "../lib/inputParsing";
import { logger } from "../lib/logger";
import { needsRenewalAttention, renewalStanding } from "../lib/renewals";
import { recordAuditEvent } from "../repositories/auditEvents";
import {
  applyTransition,
  companiesForSweep,
  getCompanyLifecycle,
  listEventsForCompany,
  listLifecycleStates,
  liveRecurringForCompanies,
  setLifecycleManual,
} from "../repositories/lifecycle";
import { RULE_KEYS, assertRuleMay } from "../automations/catalogue";
import { logRuleRun } from "../automations/runLog";
import { DEFAULT_DORMANCY_DAYS, loadDormancyDays } from "./customerReportService";
import { loadReminderSettings } from "./reminderService";
import { loadRenewalSettings } from "./renewalSettings";

/**
 * The customer lifecycle engine (FIG-1048, B3.02). A company's lifecycle state changes only through
 * `transitionCompany`, which is idempotent, writes a history row (shown on the timeline) and an audit event, and never
 * skips either.
 *
 *   lead converted            -> Prospect          (only when the company has no state yet)
 *   deal won                  -> Customer          (the state the handoff settings name, default Customer)
 *   handoff taken             -> Onboarding
 *   handoff delivered         -> Active Customer
 *   renewal due or lapsed     -> Renewal           (daily job)
 *   no activity past the threshold -> Dormant Customer (daily job; comes back to Active Customer on new activity)
 *   a person, with a reason   -> any state         (the daily job then leaves that company alone until released)
 *
 * Renewal outranks Dormant when both are true: a customer about to renew needs a person more than a customer who has
 * merely been quiet. The threshold is the organisation's dormancy setting, the same value the customer reports use.
 */

export const LIFECYCLE_KEYS = {
  PROSPECT: "PROSPECT",
  CUSTOMER: "CUSTOMER",
  ONBOARDING: "ONBOARDING",
  ACTIVE: "ACTIVE_CUSTOMER",
  DORMANT: "DORMANT_CUSTOMER",
  RENEWAL: "RENEWAL",
} as const;
export type LifecycleKey = (typeof LIFECYCLE_KEYS)[keyof typeof LIFECYCLE_KEYS];

export type LifecycleReason =
  | "LEAD_CONVERTED"
  | "DEAL_WON"
  | "HANDOFF_DELIVERED"
  | "DORMANT"
  | "REACTIVATED"
  | "RENEWAL_WINDOW"
  | "RENEWAL_DONE"
  | "MANUAL";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The states the daily job moves companies between. Prospects and Onboarding customers are left to the events that move them. */
const SWEEP_KEYS: readonly string[] = [LIFECYCLE_KEYS.CUSTOMER, LIFECYCLE_KEYS.ACTIVE, LIFECYCLE_KEYS.DORMANT, LIFECYCLE_KEYS.RENEWAL];

export interface SweepFacts {
  currentKey: string;
  lastActivity: Date | null;
  createdAt: Date;
  dormancyDays: number;
  renewalAttention: boolean;
  now: Date;
}

export interface SweepDecision {
  toKey: LifecycleKey;
  reason: LifecycleReason;
}

/** What the daily job wants for a company, or null to leave it where it is. Pure, so each rule is tested with a fixed clock. */
export function deriveSweepTarget(f: SweepFacts): SweepDecision | null {
  if (!SWEEP_KEYS.includes(f.currentKey)) return null;
  const last = f.lastActivity ?? f.createdAt;
  const quietDays = Math.floor((f.now.getTime() - last.getTime()) / DAY_MS);
  const dormant = quietDays > f.dormancyDays;
  if (f.renewalAttention) {
    return f.currentKey === LIFECYCLE_KEYS.RENEWAL ? null : { toKey: LIFECYCLE_KEYS.RENEWAL, reason: "RENEWAL_WINDOW" };
  }
  if (dormant) {
    return f.currentKey === LIFECYCLE_KEYS.DORMANT ? null : { toKey: LIFECYCLE_KEYS.DORMANT, reason: "DORMANT" };
  }
  if (f.currentKey === LIFECYCLE_KEYS.DORMANT) return { toKey: LIFECYCLE_KEYS.ACTIVE, reason: "REACTIVATED" };
  if (f.currentKey === LIFECYCLE_KEYS.RENEWAL) return { toKey: LIFECYCLE_KEYS.ACTIVE, reason: "RENEWAL_DONE" };
  return null;
}

export interface TransitionInput {
  organizationId: string;
  companyId: string;
  /** A state key (`ACTIVE_CUSTOMER`) or an explicit state id. */
  toKey?: string;
  toStateId?: string;
  reason: LifecycleReason;
  actorMembershipId?: string | null;
  note?: string | null;
  detail?: Record<string, string | number | boolean | null>;
  /** The legacy `metadata.reason` text older audit readers look for. */
  auditReason?: string;
  /** Only move a company that has no lifecycle state yet. */
  onlyIfUnset?: boolean;
  /** A person set this by hand: the daily job leaves the company alone until released. */
  manual?: boolean;
  now?: Date;
}

export type TransitionResult =
  | { changed: true; fromStateId: string | null; toStateId: string; eventId: string }
  | { changed: false; reason: "ALREADY_IN_STATE" | "STATE_MISSING" | "COMPANY_MISSING" | "HAS_STATE" | "MOVED_CONCURRENTLY" | "MANUAL_HOLD" };

export async function transitionCompany(input: TransitionInput): Promise<TransitionResult> {
  const now = input.now ?? new Date();
  const company = await getCompanyLifecycle(input.organizationId, input.companyId);
  if (!company) return { changed: false, reason: "COMPANY_MISSING" };
  const states = await listLifecycleStates(input.organizationId);
  const target = input.toStateId
    ? states.find((s) => s.id === input.toStateId && s.isActive)
    : states.find((s) => s.key === input.toKey && s.isActive);
  if (!target) {
    logger.warn({ organizationId: input.organizationId, companyId: input.companyId, toKey: input.toKey }, "Lifecycle transition found no such active state");
    return { changed: false, reason: "STATE_MISSING" };
  }
  if (input.onlyIfUnset && company.lifecycleStateId) return { changed: false, reason: "HAS_STATE" };
  if (company.lifecycleStateId === target.id) {
    // Already there. A person's explicit choice still marks the company as hand-set.
    if (input.manual && !company.lifecycleManual) await setLifecycleManual(input.organizationId, input.companyId, true);
    return { changed: false, reason: "ALREADY_IN_STATE" };
  }
  // The daily job never overrides a person's decision; real events (a deal won) do, because they are newer facts.
  if (company.lifecycleManual && !input.manual && (input.reason === "DORMANT" || input.reason === "REACTIVATED" || input.reason === "RENEWAL_WINDOW" || input.reason === "RENEWAL_DONE")) {
    return { changed: false, reason: "MANUAL_HOLD" };
  }
  const event = await applyTransition({
    organizationId: input.organizationId,
    companyId: input.companyId,
    fromStateId: company.lifecycleStateId,
    toStateId: target.id,
    reason: input.reason,
    note: input.note,
    actorMembershipId: input.actorMembershipId,
    detail: input.detail,
    manual: input.manual === true,
    now,
  });
  if (!event) return { changed: false, reason: "MOVED_CONCURRENTLY" };
  await recordAuditEvent({
    organizationId: input.organizationId,
    actorMembershipId: input.actorMembershipId ?? undefined,
    action: "company.lifecycle_state_changed",
    entityType: "Company",
    entityId: input.companyId,
    previousValue: { lifecycleStateId: company.lifecycleStateId },
    newValue: { lifecycleStateId: target.id },
    metadata: { reason: input.auditReason ?? input.reason.toLowerCase(), lifecycleReason: input.reason, eventId: event.id, ...(input.note ? { note: input.note } : {}), ...(input.detail ?? {}) },
  });
  return { changed: true, fromStateId: company.lifecycleStateId, toStateId: target.id, eventId: event.id };
}

// ---------------------------------------------------------------------------
// Manual override and history
// ---------------------------------------------------------------------------

/** A person sets the state by hand, with a reason. The daily job leaves the company alone until the override is released. */
export async function setLifecycleStateManually(ctx: AuthContext, companyId: string, input: { stateId?: string; stateKey?: string; reason: string }, now = new Date()) {
  requirePermission(ctx, "companies.edit");
  const reason = cleanText(input.reason, "reason", 300, { required: true })!;
  if (!input.stateId && !input.stateKey) {
    throw new ValidationError("Pick a lifecycle state.", [{ path: "stateId", message: "Pick a lifecycle state." }]);
  }
  const company = await getCompanyLifecycle(ctx.organizationId, companyId);
  if (!company) throw new NotFoundError("Company", companyId);
  const result = await transitionCompany({
    organizationId: ctx.organizationId,
    companyId,
    toStateId: input.stateId,
    toKey: input.stateKey,
    reason: "MANUAL",
    note: reason,
    actorMembershipId: ctx.membershipId,
    manual: true,
    auditReason: "manual_override",
    now,
  });
  if (!result.changed && result.reason === "STATE_MISSING") {
    throw new ValidationError("That lifecycle state is not available in this organisation.", [{ path: "stateId", message: "Unknown or inactive state." }]);
  }
  return getLifecycle(ctx, companyId);
}

/** Hands the company back to the rules: the next daily run puts it where its activity says it belongs. */
export async function releaseLifecycleOverride(ctx: AuthContext, companyId: string) {
  requirePermission(ctx, "companies.edit");
  const company = await getCompanyLifecycle(ctx.organizationId, companyId);
  if (!company) throw new NotFoundError("Company", companyId);
  if (company.lifecycleManual) {
    await setLifecycleManual(ctx.organizationId, companyId, false);
    await recordAuditEvent({
      organizationId: ctx.organizationId,
      actorMembershipId: ctx.membershipId,
      action: "company.lifecycle_override_released",
      entityType: "Company",
      entityId: companyId,
    });
  }
  return getLifecycle(ctx, companyId);
}

export async function getLifecycle(ctx: AuthContext, companyId: string, take = 50) {
  requirePermission(ctx, "companies.view");
  const [company, states, events] = await Promise.all([
    getCompanyLifecycle(ctx.organizationId, companyId),
    listLifecycleStates(ctx.organizationId),
    listEventsForCompany(ctx.organizationId, companyId, Math.min(Math.max(take, 1), 200)),
  ]);
  if (!company) throw new NotFoundError("Company", companyId);
  const byId = new Map(states.map((s) => [s.id, s]));
  const view = (id: string | null) => (id ? { id, key: byId.get(id)?.key ?? null, name: byId.get(id)?.name ?? null } : null);
  return {
    companyId,
    state: view(company.lifecycleStateId),
    changedAt: company.lifecycleChangedAt,
    manual: company.lifecycleManual,
    events: events.map((e) => ({
      id: e.id,
      at: e.createdAt,
      from: view(e.fromStateId),
      to: view(e.toStateId),
      reason: e.reason,
      note: e.note,
      actorMembershipId: e.actorMembershipId,
    })),
  };
}

// ---------------------------------------------------------------------------
// The daily job
// ---------------------------------------------------------------------------

export interface LifecycleSweepResult {
  checked: number;
  toDormant: number;
  toRenewal: number;
  toActive: number;
  /** Companies that went dormant in this run, for the owner notification (FIG-795). */
  becameDormant: { companyId: string; ownerMembershipId: string | null; eventId: string; quietDays: number }[];
}

/**
 * Re-evaluates every Customer, Active Customer, Renewal and Dormant company from scratch, so a changed dormancy
 * threshold is picked up on the next run. Safe to repeat: a company already in the right state is not touched, and a
 * company someone set by hand is skipped.
 */
export async function runLifecycleSweep(organizationId: string, now = new Date()): Promise<LifecycleSweepResult> {
  const [states, dormancyDays, renewalSettings] = await Promise.all([
    listLifecycleStates(organizationId),
    loadDormancyDays(organizationId).catch(() => DEFAULT_DORMANCY_DAYS),
    loadRenewalSettings(organizationId),
  ]);
  const keyById = new Map(states.filter((s) => s.isActive).map((s) => [s.id, s.key]));
  const stateIds = states.filter((s) => s.isActive && SWEEP_KEYS.includes(s.key)).map((s) => s.id);
  const rows = await companiesForSweep(organizationId, stateIds);
  const recurring = await liveRecurringForCompanies(organizationId, rows.map((r) => r.id));
  const attention = new Set<string>();
  for (const r of recurring) {
    const standing = renewalStanding({ startsOn: r.startsOn, renewsOn: r.renewsOn, cancelledAt: r.cancelledAt, stateOverride: r.stateOverride }, now, renewalSettings);
    if (needsRenewalAttention(standing.state)) attention.add(r.companyId);
  }

  const dormantFlagOn = (await loadReminderSettings(organizationId)).dormant.enabled;
  const result: LifecycleSweepResult = { checked: rows.length, toDormant: 0, toRenewal: 0, toActive: 0, becameDormant: [] };
  for (const row of rows) {
    const currentKey = keyById.get(row.lifecycleStateId);
    if (!currentKey) continue;
    const decision = deriveSweepTarget({
      currentKey,
      lastActivity: row.lastActivity,
      createdAt: row.createdAt,
      dormancyDays,
      renewalAttention: attention.has(row.id),
      now,
    });
    if (!decision) continue;
    // B4.02: flagging a customer Dormant is the "dormant customer flag" automation rule; switched off, nothing is flagged.
    if (decision.toKey === LIFECYCLE_KEYS.DORMANT) {
      assertRuleMay(RULE_KEYS.DORMANT_CUSTOMER_FLAG, "FLAG");
      if (!dormantFlagOn) continue;
    }
    const moved = await transitionCompany({
      organizationId,
      companyId: row.id,
      toKey: decision.toKey,
      reason: decision.reason,
      detail: { dormancyDays, quietDays: Math.floor((now.getTime() - (row.lastActivity ?? row.createdAt).getTime()) / DAY_MS) },
      now,
    });
    if (!moved.changed) continue;
    if (decision.toKey === LIFECYCLE_KEYS.DORMANT) {
      result.toDormant += 1;
      await logRuleRun(
        { organizationId, ruleKey: RULE_KEYS.DORMANT_CUSTOMER_FLAG, triggerKey: `flag:${row.id}:${moved.eventId}`, entityType: "Company", entityId: row.id },
        "APPLIED",
        { result: `Flagged the customer as dormant after ${Math.floor((now.getTime() - (row.lastActivity ?? row.createdAt).getTime()) / DAY_MS)} quiet days.` },
      ).catch(() => undefined);
      result.becameDormant.push({
        companyId: row.id,
        ownerMembershipId: row.ownerMembershipId,
        eventId: moved.eventId,
        quietDays: Math.floor((now.getTime() - (row.lastActivity ?? row.createdAt).getTime()) / DAY_MS),
      });
    } else if (decision.toKey === LIFECYCLE_KEYS.RENEWAL) result.toRenewal += 1;
    else result.toActive += 1;
  }
  return result;
}

