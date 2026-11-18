import type { Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { ValidationError } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import { startOfDay } from "../lib/payments";
import { recordAuditEvent } from "../repositories/auditEvents";
import { loadRenewalSettings } from "./renewalSettings";
import { needsRenewalAttention, renewalStanding } from "../lib/renewals";
import { RULE_KEYS } from "../automations/catalogue";
import { notifyForRule } from "../automations/effects";
import { loadOwnRule, runRuleOnce } from "../automations/runLog";
import { raiseOverdueInvoiceReminders } from "./paymentService";
import type { LifecycleSweepResult } from "./lifecycleService";

/**
 * Automatic reminders (FIG-795): a proposal that has had no answer, a service about to renew, a customer gone quiet, an
 * invoice past its due date. They only ever tell a person (CLAUDE.md rule 9: automations never decide), each rule can
 * be switched off, each has its own threshold, and each is keyed on its trigger so a repeat run sends nothing twice.
 */

const SETTINGS_KEY = "reminders.settings";
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReminderSettings {
  proposalFollowUp: { enabled: boolean; days: number };
  renewal: { enabled: boolean; daysAhead: number };
  dormant: { enabled: boolean };
  overdueInvoices: { enabled: boolean };
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  proposalFollowUp: { enabled: true, days: 5 },
  renewal: { enabled: true, daysAhead: 30 },
  dormant: { enabled: true },
  overdueInvoices: { enabled: true },
};

const MAX_DAYS = 365;

function whole(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_DAYS ? value : fallback;
}

export async function loadReminderSettings(organizationId: string): Promise<ReminderSettings> {
  const row = await adminDb.organizationSetting.findUnique({ where: { organizationId_key: { organizationId, key: SETTINGS_KEY } } });
  const v = (row?.value ?? {}) as Partial<{ proposalFollowUp: Partial<ReminderSettings["proposalFollowUp"]>; renewal: Partial<ReminderSettings["renewal"]>; dormant: Partial<ReminderSettings["dormant"]>; overdueInvoices: Partial<ReminderSettings["overdueInvoices"]> }>;
  const d = DEFAULT_REMINDER_SETTINGS;
  return {
    proposalFollowUp: { enabled: v.proposalFollowUp?.enabled ?? d.proposalFollowUp.enabled, days: whole(v.proposalFollowUp?.days, d.proposalFollowUp.days) },
    renewal: { enabled: v.renewal?.enabled ?? d.renewal.enabled, daysAhead: whole(v.renewal?.daysAhead, d.renewal.daysAhead) },
    dormant: { enabled: v.dormant?.enabled ?? d.dormant.enabled },
    overdueInvoices: { enabled: v.overdueInvoices?.enabled ?? d.overdueInvoices.enabled },
  };
}

export async function getReminderSettings(ctx: AuthContext) {
  requirePermission(ctx, "organization.manage_settings");
  return loadReminderSettings(ctx.organizationId);
}

export interface ReminderSettingsPatch {
  proposalFollowUp?: { enabled?: boolean; days?: number };
  renewal?: { enabled?: boolean; daysAhead?: number };
  dormant?: { enabled?: boolean };
  overdueInvoices?: { enabled?: boolean };
}

function checkDays(value: number | undefined, path: string) {
  if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > MAX_DAYS)) {
    throw new ValidationError(`${path} must be a whole number of days from 1 to ${MAX_DAYS}.`, [{ path, message: `1 to ${MAX_DAYS} days.` }]);
  }
}

function checkFlag(value: unknown, path: string) {
  if (value !== undefined && typeof value !== "boolean") {
    throw new ValidationError(`${path} must be true or false.`, [{ path, message: "True or false." }]);
  }
}

export async function updateReminderSettings(ctx: AuthContext, patch: ReminderSettingsPatch) {
  requirePermission(ctx, "organization.manage_settings");
  checkDays(patch.proposalFollowUp?.days, "proposalFollowUp.days");
  checkDays(patch.renewal?.daysAhead, "renewal.daysAhead");
  for (const [rule, value] of Object.entries(patch)) checkFlag((value as { enabled?: unknown } | undefined)?.enabled, `${rule}.enabled`);
  const before = await loadReminderSettings(ctx.organizationId);
  const next: ReminderSettings = {
    proposalFollowUp: { ...before.proposalFollowUp, ...stripUndefined(patch.proposalFollowUp) },
    renewal: { ...before.renewal, ...stripUndefined(patch.renewal) },
    dormant: { ...before.dormant, ...stripUndefined(patch.dormant) },
    overdueInvoices: { ...before.overdueInvoices, ...stripUndefined(patch.overdueInvoices) },
  };
  const value = next as unknown as Prisma.InputJsonValue;
  await adminDb.organizationSetting.upsert({
    where: { organizationId_key: { organizationId: ctx.organizationId, key: SETTINGS_KEY } },
    update: { value },
    create: { organizationId: ctx.organizationId, key: SETTINGS_KEY, value },
  });
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "reminder_settings.updated",
    entityType: "ReminderSettings",
    previousValue: before as unknown as Prisma.InputJsonValue,
    newValue: value,
  });
  return next;
}

function stripUndefined<T extends object>(o: T | undefined): Partial<T> {
  return o ? (Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>) : {};
}

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

const dateKey = (d: Date) => d.toISOString().slice(0, 10);

/** A proposal sent and not touched for N days tells the person who owns it (the proposal's owner, else the deal's). */
export async function raiseProposalReminders(organizationId: string, now = new Date()): Promise<{ proposals: number; notified: number }> {
  const settings = await loadReminderSettings(organizationId);
  if (!settings.proposalFollowUp.enabled) return { proposals: 0, notified: 0 };
  const cutoff = new Date(now.getTime() - settings.proposalFollowUp.days * DAY_MS);
  const proposals = await adminDb.proposalReference.findMany({
    where: { organizationId, status: "SENT", updatedAt: { lt: cutoff }, deal: { outcome: "OPEN", archivedAt: null } },
    select: { id: true, proposalNumber: true, sentAt: true, updatedAt: true, ownerMembershipId: true, dealId: true, deal: { select: { ownerMembershipId: true, company: { select: { name: true } } } } },
  });
  if (proposals.length === 0) return { proposals: 0, notified: 0 };
  const org = await adminDb.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { slug: true } });
  const audience = (await loadOwnRule(organizationId, RULE_KEYS.PROPOSAL_FOLLOW_UP)).audience;
  let notified = 0;
  for (const p of proposals) {
    const recipient = p.ownerMembershipId ?? p.deal.ownerMembershipId;
    if (!recipient) continue;
    const since = Math.floor((now.getTime() - (p.sentAt ?? p.updatedAt).getTime()) / DAY_MS);
    // One effect per trigger, recorded in the automation run log (B4.02).
    await runRuleOnce(
      { organizationId, ruleKey: RULE_KEYS.PROPOSAL_FOLLOW_UP, triggerKey: `proposal:${p.id}:${dateKey(p.updatedAt)}`, entityType: "ProposalReference", entityId: p.id },
      async () => {
        const people = await notifyForRule({
          organizationId,
          ruleKey: RULE_KEYS.PROPOSAL_FOLLOW_UP,
          ownerMembershipId: recipient,
          audience,
          type: "PROPOSAL_UNANSWERED",
          title: `No answer yet: proposal ${p.proposalNumber}`,
          body: `${p.deal.company.name} has not replied to the proposal sent ${since} day${since === 1 ? "" : "s"} ago. A follow-up may help.`,
          entityType: "ProposalReference",
          entityId: `${p.id}:${dateKey(p.updatedAt)}`,
          path: `/o/${org.slug}/deals/${p.dealId}`,
        });
        notified += people;
        return { result: `Reminded ${people} ${people === 1 ? "person" : "people"} that the proposal had no answer for ${since} days.` };
      },
    );
  }
  return { proposals: proposals.length, notified };
}

/** A service renewing within N days tells its owner (else the company's owner). Company services with an end date and no recurring record are covered too. */
export async function raiseRenewalReminders(organizationId: string, now = new Date()): Promise<{ services: number; notified: number }> {
  const settings = await loadReminderSettings(organizationId);
  if (!settings.renewal.enabled) return { services: 0, notified: 0 };
  const renewalSettings = await loadRenewalSettings(organizationId);
  const today = startOfDay(now);
  const horizon = new Date(today.getTime() + settings.renewal.daysAhead * DAY_MS);
  const org = await adminDb.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { slug: true } });
  const audience = (await loadOwnRule(organizationId, RULE_KEYS.RENEWAL_REMINDER)).audience;
  let services = 0;
  let notified = 0;

  const recurring = await adminDb.recurringService.findMany({
    where: { organizationId, cancelledAt: null, renewsOn: { lte: horizon }, startsOn: { lte: today } },
    select: { id: true, renewsOn: true, startsOn: true, cancelledAt: true, stateOverride: true, ownerMembershipId: true, companyId: true, service: { select: { name: true } }, company: { select: { name: true, ownerMembershipId: true } } },
  });
  for (const r of recurring) {
    const standing = renewalStanding({ startsOn: r.startsOn, renewsOn: r.renewsOn, cancelledAt: r.cancelledAt, stateOverride: r.stateOverride }, today, renewalSettings);
    if (!needsRenewalAttention(standing.state) && standing.daysToRenewal > settings.renewal.daysAhead) continue;
    if (standing.state === "CANCELLED" || standing.state === "STARTS_LATER") continue;
    const recipient = r.ownerMembershipId ?? r.company.ownerMembershipId;
    if (!recipient) continue;
    services += 1;
    const d = standing.daysToRenewal;
    await runRuleOnce(
      { organizationId, ruleKey: RULE_KEYS.RENEWAL_REMINDER, triggerKey: `service:${r.id}:${dateKey(r.renewsOn)}`, entityType: "RecurringService", entityId: r.id },
      async () => {
        const people = await notifyForRule({
          organizationId,
          ruleKey: RULE_KEYS.RENEWAL_REMINDER,
          ownerMembershipId: recipient,
          audience,
          type: "RENEWAL_DUE",
          title: d < 0 ? `Renewal overdue: ${r.service.name} for ${r.company.name}` : `Renewal coming up: ${r.service.name} for ${r.company.name}`,
          body: d < 0 ? `It was due ${-d} day${d === -1 ? "" : "s"} ago.` : d === 0 ? "It renews today." : `It renews in ${d} day${d === 1 ? "" : "s"}.`,
          entityType: "RecurringService",
          entityId: `${r.id}:${dateKey(r.renewsOn)}`,
          path: `/o/${org.slug}/companies/${r.companyId}`,
        });
        notified += people;
        return { result: d < 0 ? `Reminded ${people} that the renewal was ${-d} days overdue.` : `Reminded ${people} that the service renews in ${d} days.` };
      },
    );
  }

  const links = await adminDb.companyService.findMany({
    where: { organizationId, status: "ACTIVE", endDate: { gte: today, lte: horizon } },
    select: { id: true, endDate: true, companyId: true, service: { select: { name: true } }, company: { select: { name: true, ownerMembershipId: true } } },
  });
  const mirrored = new Set((await adminDb.recurringService.findMany({ where: { organizationId, companyServiceId: { in: links.map((l) => l.id) } }, select: { companyServiceId: true } })).map((r) => r.companyServiceId));
  for (const l of links) {
    if (mirrored.has(l.id) || !l.company.ownerMembershipId || !l.endDate) continue;
    services += 1;
    const d = Math.round((startOfDay(l.endDate).getTime() - today.getTime()) / DAY_MS);
    const endDate = l.endDate;
    await runRuleOnce(
      { organizationId, ruleKey: RULE_KEYS.RENEWAL_REMINDER, triggerKey: `company_service:${l.id}:${dateKey(endDate)}`, entityType: "CompanyService", entityId: l.id },
      async () => {
        const people = await notifyForRule({
          organizationId,
          ruleKey: RULE_KEYS.RENEWAL_REMINDER,
          ownerMembershipId: l.company.ownerMembershipId,
          audience,
          type: "RENEWAL_DUE",
          title: `Ends soon: ${l.service.name} for ${l.company.name}`,
          body: d === 0 ? "It ends today." : `It ends in ${d} day${d === 1 ? "" : "s"}.`,
          entityType: "CompanyService",
          entityId: `${l.id}:${dateKey(endDate)}`,
          path: `/o/${org.slug}/companies/${l.companyId}`,
        });
        notified += people;
        return { result: `Reminded ${people} that the service ends in ${d} days.` };
      },
    );
  }
  return { services, notified };
}

/** Tells the owner of each customer that went dormant in this run (the lifecycle job's result). */
export async function raiseDormantReminders(organizationId: string, becameDormant: LifecycleSweepResult["becameDormant"]): Promise<{ notified: number }> {
  const settings = await loadReminderSettings(organizationId);
  if (!settings.dormant.enabled || becameDormant.length === 0) return { notified: 0 };
  const org = await adminDb.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { slug: true } });
  const names = new Map((await adminDb.company.findMany({ where: { organizationId, id: { in: becameDormant.map((b) => b.companyId) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  const audience = (await loadOwnRule(organizationId, RULE_KEYS.DORMANT_CUSTOMER_FLAG)).audience;
  let notified = 0;
  for (const b of becameDormant) {
    if (!b.ownerMembershipId) continue;
    await runRuleOnce(
      { organizationId, ruleKey: RULE_KEYS.DORMANT_CUSTOMER_FLAG, triggerKey: `company:${b.companyId}:${b.eventId}`, entityType: "Company", entityId: b.companyId },
      async () => {
        const people = await notifyForRule({
          organizationId,
          ruleKey: RULE_KEYS.DORMANT_CUSTOMER_FLAG,
          ownerMembershipId: b.ownerMembershipId,
          audience,
          type: "DORMANT_CUSTOMER",
          title: `${names.get(b.companyId) ?? "A customer"} has gone quiet`,
          body: `No activity for ${b.quietDays} days. A call or a message may bring them back.`,
          entityType: "Company",
          entityId: `${b.companyId}:${b.eventId}`,
          path: `/o/${org.slug}/companies/${b.companyId}`,
        });
        notified += people;
        return { result: `Told ${people} ${people === 1 ? "person" : "people"} the customer had been quiet for ${b.quietDays} days.` };
      },
    );
  }
  return { notified };
}

export interface RemindersResult {
  proposals: { proposals: number; notified: number };
  renewals: { services: number; notified: number };
  invoices: { invoices: number; notified: number };
}

/** The daily reminder run for one organisation. */
export async function runReminders(organizationId: string, now = new Date()): Promise<RemindersResult> {
  const settings = await loadReminderSettings(organizationId);
  return {
    proposals: await raiseProposalReminders(organizationId, now),
    renewals: await raiseRenewalReminders(organizationId, now),
    invoices: settings.overdueInvoices.enabled ? await raiseOverdueInvoiceReminders(organizationId, now) : { invoices: 0, notified: 0 },
  };
}
