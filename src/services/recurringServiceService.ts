import type { Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { hasPermission, requirePermission } from "../auth/context";
import { maskServiceValue } from "../auth/masking";
import { NotFoundError, ValidationError } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import { assertWritable } from "../lib/archive";
import { cleanText, parseDateOnly, parseMoneyCents } from "../lib/inputParsing";
import { buildPage, resolvePaging, type PageRequest } from "../lib/pagination";
import { fromCents, startOfDay } from "../lib/payments";
import {
  BILLING_CYCLES,
  MAX_DUE_SOON_DAYS,
  MAX_GRACE_DAYS,
  RENEWAL_STATES,
  renewalStanding,
  renewedUntil,
  type BillingCycle,
  type RenewalSettings,
  type RenewalState,
} from "../lib/renewals";
import { createActivity } from "../repositories/activities";
import { recordAuditEvent } from "../repositories/auditEvents";
import { getRecurringRow, insertRecurring, listRecurringRows, updateRecurringRow, type RecurringServiceRow } from "../repositories/recurringServices";
import { createTask } from "../repositories/tasks";
import { getCompany } from "./companyService";
import { createInvoice } from "./paymentService";
import { assertEligibleTaskAssignee } from "./ownerEligibility";
import { loadRenewalSettings, RENEWAL_SETTINGS_KEY } from "./renewalSettings";

/**
 * Recurring services and renewals (FIG-1051, B3.05): hosting, Starlink plans, retainers. Each has a billing cycle, a
 * value (masked like a deal's), a renewal date and an owner. The renewal state is derived from the dates by rule
 * (`src/lib/renewals.ts`); a person may override it, always with a reason.
 *
 *   view   : `company_services.view`
 *   change : `company_services.manage`
 *   renew  : also `tasks.create` for the optional task and `finance.manage.payments` for the optional invoice
 */

// ---------------------------------------------------------------------------
// Settings: the due window and the lapse grace
// ---------------------------------------------------------------------------

export { loadRenewalSettings };

export async function getRenewalSettings(ctx: AuthContext) {
  requirePermission(ctx, "company_services.view");
  return loadRenewalSettings(ctx.organizationId);
}

export async function updateRenewalSettings(ctx: AuthContext, input: Partial<RenewalSettings>) {
  requirePermission(ctx, "organization.manage_settings");
  const before = await loadRenewalSettings(ctx.organizationId);
  const next = { ...before };
  if (input.dueSoonDays !== undefined) {
    if (!Number.isInteger(input.dueSoonDays) || input.dueSoonDays < 1 || input.dueSoonDays > MAX_DUE_SOON_DAYS) {
      throw new ValidationError(`dueSoonDays must be a whole number from 1 to ${MAX_DUE_SOON_DAYS}.`, [{ path: "dueSoonDays", message: `1 to ${MAX_DUE_SOON_DAYS} days.` }]);
    }
    next.dueSoonDays = input.dueSoonDays;
  }
  if (input.graceDays !== undefined) {
    if (!Number.isInteger(input.graceDays) || input.graceDays < 0 || input.graceDays > MAX_GRACE_DAYS) {
      throw new ValidationError(`graceDays must be a whole number from 0 to ${MAX_GRACE_DAYS}.`, [{ path: "graceDays", message: `0 to ${MAX_GRACE_DAYS} days.` }]);
    }
    next.graceDays = input.graceDays;
  }
  const value = next as unknown as Prisma.InputJsonValue;
  await adminDb.organizationSetting.upsert({
    where: { organizationId_key: { organizationId: ctx.organizationId, key: RENEWAL_SETTINGS_KEY } },
    update: { value },
    create: { organizationId: ctx.organizationId, key: RENEWAL_SETTINGS_KEY, value },
  });
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "renewal_settings.updated",
    entityType: "RenewalSettings",
    previousValue: { ...before },
    newValue: { ...next },
  });
  return next;
}

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

export function toRecurringView(ctx: AuthContext, row: RecurringServiceRow, today: Date, settings: RenewalSettings) {
  const standing = renewalStanding({ startsOn: row.startsOn, renewsOn: row.renewsOn, cancelledAt: row.cancelledAt, stateOverride: row.stateOverride }, today, settings);
  const masked = maskServiceValue(ctx, { ownerMembershipId: row.ownerMembershipId, value: row.value ? fromCents(Math.round(Number(row.value) * 100)) : null });
  return {
    id: row.id,
    companyId: row.companyId,
    companyName: row.company.name,
    serviceId: row.serviceId,
    serviceName: row.service.name,
    billingCycle: row.billingCycle,
    value: masked.value as string | null,
    valueMasked: masked.valueMasked,
    currency: row.currency,
    startsOn: row.startsOn,
    renewsOn: row.renewsOn,
    daysToRenewal: standing.daysToRenewal,
    state: standing.state,
    stateSource: standing.source,
    overrideReason: row.overrideReason,
    ownerMembershipId: row.ownerMembershipId,
    autoRenew: row.autoRenew,
    cancelledAt: row.cancelledAt,
    cancelReason: row.cancelReason,
    lastRenewedAt: row.lastRenewedAt,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
export type RecurringServiceView = ReturnType<typeof toRecurringView>;

/** The audit snapshot carries the real value (the audit reader masks it by role), not the caller's masked one. */
const auditSnapshot = (row: RecurringServiceRow) => ({
  companyId: row.companyId,
  serviceId: row.serviceId,
  billingCycle: row.billingCycle,
  value: row.value ? fromCents(Math.round(Number(row.value) * 100)) : null,
  renewsOn: row.renewsOn,
  stateOverride: row.stateOverride,
  autoRenew: row.autoRenew,
  cancelled: row.cancelledAt !== null,
});

async function loadOrThrow(ctx: AuthContext, id: string) {
  const row = await getRecurringRow(ctx.organizationId, id);
  if (!row) throw new NotFoundError("RecurringService", id);
  return row;
}

async function viewOf(ctx: AuthContext, row: RecurringServiceRow, now: Date) {
  return toRecurringView(ctx, row, startOfDay(now), await loadRenewalSettings(ctx.organizationId));
}

function parseCycle(value: unknown): BillingCycle {
  if (typeof value === "string" && (BILLING_CYCLES as readonly string[]).includes(value)) return value as BillingCycle;
  throw new ValidationError("billingCycle is not valid.", [{ path: "billingCycle", message: `Use ${BILLING_CYCLES.join(", ")}.` }]);
}

async function assertActiveOwner(organizationId: string, membershipId: string) {
  const owner = await adminDb.membership.findFirst({ where: { id: membershipId, organizationId, status: "ACTIVE" }, select: { id: true } });
  if (!owner) throw new ValidationError("The owner is not an active member.", [{ path: "ownerMembershipId", message: "Pick an active member." }]);
}

// ---------------------------------------------------------------------------
// Create, change, cancel, override
// ---------------------------------------------------------------------------

export interface RecurringInput {
  companyId: string;
  serviceId: string;
  billingCycle?: BillingCycle;
  value?: number | string | null;
  currency?: string;
  startsOn: string;
  renewsOn: string;
  ownerMembershipId?: string | null;
  autoRenew?: boolean;
  notes?: string | null;
}

export async function createRecurringService(ctx: AuthContext, input: RecurringInput, now = new Date()) {
  requirePermission(ctx, "company_services.manage");
  const company = await getCompany(ctx, input.companyId);
  assertWritable(ctx, "company", company, "adding to it");
  const service = await adminDb.service.findFirst({ where: { id: input.serviceId, organizationId: ctx.organizationId }, select: { id: true } });
  if (!service) throw new ValidationError("That service is not in this organisation.", [{ path: "serviceId", message: "Pick a service from the catalogue." }]);
  const startsOn = parseDateOnly(input.startsOn, "startsOn");
  const renewsOn = parseDateOnly(input.renewsOn, "renewsOn");
  if (renewsOn < startsOn) throw new ValidationError("The renewal date is before the start date.", [{ path: "renewsOn", message: "On or after the start date." }]);
  const ownerMembershipId = input.ownerMembershipId === undefined ? (company.ownerMembershipId ?? ctx.membershipId) : input.ownerMembershipId;
  if (ownerMembershipId) await assertActiveOwner(ctx.organizationId, ownerMembershipId);
  const valueCents = input.value === undefined || input.value === null || input.value === "" ? null : parseMoneyCents(input.value, "value", { allowZero: true });
  const row = await insertRecurring({
    organizationId: ctx.organizationId,
    companyId: input.companyId,
    serviceId: input.serviceId,
    billingCycle: parseCycle(input.billingCycle ?? "YEARLY"),
    value: valueCents === null ? null : fromCents(valueCents),
    currency: (input.currency ?? "KES").toUpperCase(),
    startsOn,
    renewsOn,
    ownerMembershipId,
    autoRenew: input.autoRenew === true,
    notes: cleanText(input.notes, "notes", 1000),
    createdByMembershipId: ctx.membershipId,
  });
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "recurring_service.created", entityType: "RecurringService", entityId: row.id, newValue: auditSnapshot(row) });
  return viewOf(ctx, row, now);
}

export async function getRecurringService(ctx: AuthContext, id: string, now = new Date()) {
  requirePermission(ctx, "company_services.view");
  return viewOf(ctx, await loadOrThrow(ctx, id), now);
}

export async function updateRecurringService(
  ctx: AuthContext,
  id: string,
  patch: { billingCycle?: BillingCycle; value?: number | string | null; renewsOn?: string; startsOn?: string; ownerMembershipId?: string | null; autoRenew?: boolean; notes?: string | null },
  now = new Date(),
) {
  requirePermission(ctx, "company_services.manage");
  const before = await loadOrThrow(ctx, id);
  assertWritable(ctx, "company", before.company, "changing it");
  if (before.cancelledAt) throw new ValidationError("This service is cancelled.", [{ path: "state", message: "A cancelled service cannot be changed.", code: "SERVICE_CANCELLED" }]);
  const data: Prisma.RecurringServiceUncheckedUpdateInput = {};
  if (patch.billingCycle !== undefined) data.billingCycle = parseCycle(patch.billingCycle);
  if (patch.value !== undefined) data.value = patch.value === null || patch.value === "" ? null : fromCents(parseMoneyCents(patch.value, "value", { allowZero: true }));
  const startsOn = patch.startsOn !== undefined ? parseDateOnly(patch.startsOn, "startsOn") : before.startsOn;
  const renewsOn = patch.renewsOn !== undefined ? parseDateOnly(patch.renewsOn, "renewsOn") : before.renewsOn;
  if (renewsOn < startsOn) throw new ValidationError("The renewal date is before the start date.", [{ path: "renewsOn", message: "On or after the start date." }]);
  if (patch.startsOn !== undefined) data.startsOn = startsOn;
  if (patch.renewsOn !== undefined) data.renewsOn = renewsOn;
  if (patch.ownerMembershipId !== undefined) {
    if (patch.ownerMembershipId) await assertActiveOwner(ctx.organizationId, patch.ownerMembershipId);
    data.ownerMembershipId = patch.ownerMembershipId;
  }
  if (patch.autoRenew !== undefined) data.autoRenew = patch.autoRenew === true;
  if (patch.notes !== undefined) data.notes = cleanText(patch.notes, "notes", 1000);
  const row = await updateRecurringRow(ctx.organizationId, id, data);
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "recurring_service.updated", entityType: "RecurringService", entityId: id, previousValue: auditSnapshot(before), newValue: auditSnapshot(row) });
  return viewOf(ctx, row, now);
}

export async function cancelRecurringService(ctx: AuthContext, id: string, input: { reason: string }, now = new Date()) {
  requirePermission(ctx, "company_services.manage");
  const reason = cleanText(input.reason, "reason", 300, { required: true })!;
  const before = await loadOrThrow(ctx, id);
  assertWritable(ctx, "company", before.company, "changing it");
  if (before.cancelledAt) return viewOf(ctx, before, now);
  const row = await updateRecurringRow(ctx.organizationId, id, { cancelledAt: now, cancelReason: reason });
  await createActivity({ organizationId: ctx.organizationId, type: "NOTE", subject: `Cancelled: ${row.service.name}`, description: reason, authorMembershipId: ctx.membershipId, companyId: row.companyId });
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "recurring_service.cancelled", entityType: "RecurringService", entityId: id, previousValue: auditSnapshot(before), newValue: auditSnapshot(row), metadata: { reason } });
  return viewOf(ctx, row, now);
}

/** A person decides the state, against the rule. Always with a reason; clear it to hand the state back to the dates. */
export async function overrideRenewalState(ctx: AuthContext, id: string, input: { state: RenewalState | null; reason?: string }, now = new Date()) {
  requirePermission(ctx, "company_services.manage");
  const before = await loadOrThrow(ctx, id);
  assertWritable(ctx, "company", before.company, "changing it");
  if (input.state === null) {
    const row = await updateRecurringRow(ctx.organizationId, id, { stateOverride: null, overrideReason: null });
    await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "recurring_service.override_cleared", entityType: "RecurringService", entityId: id, previousValue: auditSnapshot(before), newValue: auditSnapshot(row) });
    return viewOf(ctx, row, now);
  }
  if (!(RENEWAL_STATES as readonly string[]).includes(input.state) || input.state === "CANCELLED") {
    throw new ValidationError("That state cannot be set by hand.", [{ path: "state", message: "Use ACTIVE, DUE_SOON, LAPSED or STARTS_LATER. Cancel the service to cancel it." }]);
  }
  const reason = cleanText(input.reason, "reason", 300, { required: true })!;
  const row = await updateRecurringRow(ctx.organizationId, id, { stateOverride: input.state, overrideReason: reason });
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "recurring_service.state_overridden", entityType: "RecurringService", entityId: id, previousValue: auditSnapshot(before), newValue: auditSnapshot(row), metadata: { reason, state: input.state } });
  return viewOf(ctx, row, now);
}

// ---------------------------------------------------------------------------
// Renew
// ---------------------------------------------------------------------------

export interface RenewInput {
  /** Also create a task for the renewal (needs `tasks.create`). */
  task?: { title?: string; dueOn?: string; assigneeMembershipId?: string };
  /** Also create a draft invoice for the new period (needs `finance.manage.payments`). */
  invoice?: { number: string; amount?: number | string; dueOn?: string };
}

/**
 * Renews for the next period. The new date is one period on from the old one (and, for a late renewal, ahead of today),
 * any override is cleared, a note goes on the company's timeline, and the optional task and invoice are created.
 */
export async function renewRecurringService(ctx: AuthContext, id: string, input: RenewInput = {}, now = new Date()) {
  requirePermission(ctx, "company_services.manage");
  if (input.task && !hasPermission(ctx, "tasks.create")) requirePermission(ctx, "tasks.create");
  if (input.invoice) requirePermission(ctx, "finance.manage.payments");
  const before = await loadOrThrow(ctx, id);
  assertWritable(ctx, "company", before.company, "renewing it");
  if (before.cancelledAt) throw new ValidationError("A cancelled service cannot be renewed.", [{ path: "state", message: "Cancelled.", code: "SERVICE_CANCELLED" }]);
  const today = startOfDay(now);
  const nextRenewsOn = renewedUntil(before.renewsOn, before.billingCycle, today);

  const row = await updateRecurringRow(ctx.organizationId, id, { renewsOn: nextRenewsOn, lastRenewedAt: now, stateOverride: null, overrideReason: null });
  const label = nextRenewsOn.toISOString().slice(0, 10);
  await createActivity({
    organizationId: ctx.organizationId,
    type: "NOTE",
    subject: `Renewed: ${row.service.name}`,
    description: `Renewed until ${label}.`,
    authorMembershipId: ctx.membershipId,
    companyId: row.companyId,
  });

  let taskId: string | null = null;
  if (input.task) {
    const assignee = input.task.assigneeMembershipId ?? row.ownerMembershipId ?? ctx.membershipId;
    await assertEligibleTaskAssignee(ctx.organizationId, assignee);
    const task = await createTask({
      organizationId: ctx.organizationId,
      title: cleanText(input.task.title, "task.title", 200) ?? `Renewal: ${row.service.name} for ${row.company.name}`,
      assigneeMembershipId: assignee,
      createdByMembershipId: ctx.membershipId,
      dueAt: input.task.dueOn ? parseDateOnly(input.task.dueOn, "task.dueOn") : before.renewsOn,
      companyId: row.companyId,
    });
    taskId = task.id;
  }

  let invoiceId: string | null = null;
  if (input.invoice) {
    const amount = input.invoice.amount ?? row.value?.toString();
    if (amount === undefined || amount === null) {
      throw new ValidationError("The service has no value, so the invoice needs an amount.", [{ path: "invoice.amount", message: "Enter the amount to invoice." }]);
    }
    const invoice = await createInvoice(ctx, {
      number: input.invoice.number,
      amount,
      currency: row.currency,
      issuedOn: today.toISOString().slice(0, 10),
      dueOn: input.invoice.dueOn ?? new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      companyId: row.companyId,
      recurringServiceId: row.id,
      notes: `Renewal of ${row.service.name} until ${label}.`,
    }, now);
    invoiceId = invoice.id;
  }

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "recurring_service.renewed",
    entityType: "RecurringService",
    entityId: id,
    previousValue: auditSnapshot(before),
    newValue: auditSnapshot(row),
    metadata: { taskId, invoiceId },
  });
  return { service: await viewOf(ctx, row, now), taskId, invoiceId };
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export interface RecurringFilters {
  companyId?: string;
  state?: string;
  ownerMembershipId?: string;
  serviceId?: string;
}

const STATE_SCAN_LIMIT = 5000;

export async function listRecurringServices(ctx: AuthContext, filters: RecurringFilters = {}, request: PageRequest = {}, now = new Date()) {
  requirePermission(ctx, "company_services.view");
  if (filters.state && !(RENEWAL_STATES as readonly string[]).includes(filters.state)) {
    throw new ValidationError(`Unknown state "${filters.state}".`, [{ path: "state", message: `Use one of ${RENEWAL_STATES.join(", ")}.` }]);
  }
  const settings = await loadRenewalSettings(ctx.organizationId);
  const today = startOfDay(now);
  const where: Prisma.RecurringServiceWhereInput = {
    ...(filters.companyId ? { companyId: filters.companyId } : {}),
    ...(filters.ownerMembershipId ? { ownerMembershipId: filters.ownerMembershipId } : {}),
    ...(filters.serviceId ? { serviceId: filters.serviceId } : {}),
  };
  const order: Prisma.RecurringServiceOrderByWithRelationInput[] = [{ renewsOn: "asc" }, { id: "asc" }];
  const paging = resolvePaging(request);
  if (!filters.state) {
    const { rows, total } = await listRecurringRows(ctx.organizationId, where, order, paging.skip, paging.take);
    return buildPage(rows.map((r) => toRecurringView(ctx, r, today, settings)), total, paging);
  }
  // A state is derived from dates and overrides, so it is filtered after the rows are read.
  const { rows } = await listRecurringRows(ctx.organizationId, where, order, undefined, STATE_SCAN_LIMIT);
  const all = rows.map((r) => toRecurringView(ctx, r, today, settings)).filter((v) => v.state === filters.state);
  return buildPage(all.slice(paging.skip, paging.skip + paging.take), all.length, paging);
}
