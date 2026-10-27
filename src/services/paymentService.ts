import { Prisma } from "@prisma/client";
import { stringifyCsv as stringify } from "../lib/csv";
import type { AuthContext } from "../auth/context";
import { hasPermission, requirePermission } from "../auth/context";
import { NotFoundError, ValidationError } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import { cleanText, parseDateOnly, parseMoneyCents, parseOptionalDate } from "../lib/inputParsing";
import { parseSort } from "../lib/listQuery";
import { RULE_KEYS } from "../automations/catalogue";
import { logRuleRun } from "../automations/runLog";
import { buildPage, resolvePaging, type PageRequest } from "../lib/pagination";
import {
  INVOICE_STATUSES,
  checkNewPayment,
  fromCents,
  standingOf,
  startOfDay,
  statusAfterPayments,
  toCents,
  type InvoiceStatus,
} from "../lib/payments";
import {
  activePaidCents,
  collectedBetween,
  deletePaymentNote,
  findInvoiceByNumber,
  getCompanyForInvoice,
  getDealForInvoice,
  getInvoiceRow,
  getPaymentNote,
  insertInvoice,
  listAllInvoiceRows,
  listInvoiceRows,
  listWonDealRows,
  paymentAggregates,
  statusTotals,
  upsertPaymentNote,
  withLockedInvoice,
  type InvoiceWithPayments,
} from "../repositories/invoices";
import { recordAuditEvent } from "../repositories/auditEvents";
import { assertBulkExportAllowed } from "./exportService";
import { notifyEvent } from "./notificationService";

/**
 * The Payments tracker (FIG-1049 B3.03, FIG-1050 B3.04). Status only: invoices and the payments received against them,
 * linked to won deals. No amount is processed and no bank detail is stored.
 *
 *   view   : `finance.view.payments`   (Finance, Management)
 *   change : `finance.manage.payments` (Finance, Management)
 *   note   : `finance.followup.note` or `finance.manage.payments`
 *
 * Nobody else gets any of it, anywhere: not the list, not Customer 360, not search, not exports (docs/MASKING.md).
 */

const MAX_NOTES = 1000;

/** A stored amount as a string with two decimals, however Prisma prints the Decimal. */
function money(value: { toString(): string }): string {
  return fromCents(toCents(value));
}
export const INVOICE_SORT_FIELDS = ["dueOn", "issuedOn", "amount", "number", "createdAt"] as const;
export const MAX_INVOICE_EXPORT_ROWS = 20_000;

export function canViewPayments(ctx: Pick<AuthContext, "permissionKeys">): boolean {
  return ctx.permissionKeys.includes("finance.view.payments");
}

function requireView(ctx: AuthContext) {
  requirePermission(ctx, "finance.view.payments");
}
function requireManage(ctx: AuthContext) {
  requirePermission(ctx, "finance.manage.payments");
}
function canWriteNote(ctx: AuthContext) {
  return hasPermission(ctx, "finance.followup.note") || hasPermission(ctx, "finance.manage.payments");
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

function standing(row: { status: "DRAFT" | "SENT" | "PART_PAID" | "PAID" | "VOID"; amount: Prisma.Decimal; dueOn: Date; payments: { amount: Prisma.Decimal; reversedAt?: Date | null }[] }, today: Date) {
  const paidCents = row.payments.filter((p) => !p.reversedAt).reduce((sum, p) => sum + toCents(p.amount), 0);
  return standingOf({ status: row.status, amountCents: toCents(row.amount), paidCents, dueOn: row.dueOn }, today);
}

type InvoiceListRow = Omit<InvoiceWithPayments, "payments"> & { payments: { amount: Prisma.Decimal; reversedAt?: Date | null }[] };

export function toInvoiceView(row: InvoiceListRow, today: Date) {
  const s = standing(row, today);
  return {
    id: row.id,
    number: row.number,
    status: s.status,
    storedStatus: row.status,
    dealId: row.dealId,
    companyId: row.companyId,
    companyName: row.company.name,
    recurringServiceId: row.recurringServiceId,
    amount: money(row.amount),
    currency: row.currency,
    paidAmount: fromCents(s.paidCents),
    balance: fromCents(s.balanceCents),
    overpaid: fromCents(s.overpaidCents),
    overdue: s.overdue,
    daysOverdue: s.daysOverdue,
    issuedOn: row.issuedOn,
    dueOn: row.dueOn,
    allowOverpayment: row.allowOverpayment,
    notes: row.notes,
    voidedAt: row.voidedAt,
    voidReason: row.voidReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type InvoiceView = ReturnType<typeof toInvoiceView>;

function toPaymentView(p: { id: string; invoiceId: string; amount: Prisma.Decimal; paidOn: Date; methodLabel: string | null; reference: string | null; recordedByMembershipId: string | null; reversedAt: Date | null; reversalReason: string | null; createdAt: Date }) {
  return {
    id: p.id,
    invoiceId: p.invoiceId,
    amount: money(p.amount),
    paidOn: p.paidOn,
    methodLabel: p.methodLabel,
    reference: p.reference,
    recordedByMembershipId: p.recordedByMembershipId,
    reversed: p.reversedAt !== null,
    reversedAt: p.reversedAt,
    reversalReason: p.reversalReason,
    createdAt: p.createdAt,
  };
}

async function invoiceDetail(organizationId: string, id: string, today: Date) {
  const row = await getInvoiceRow(organizationId, id);
  if (!row) throw new NotFoundError("Invoice", id);
  return { ...toInvoiceView(row, today), payments: row.payments.map(toPaymentView) };
}

const snapshot = (v: InvoiceView) => ({ number: v.number, status: v.storedStatus, amount: v.amount, dueOn: v.dueOn, issuedOn: v.issuedOn, dealId: v.dealId, companyId: v.companyId });

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

export interface InvoiceInput {
  number: string;
  amount: number | string;
  currency?: string;
  issuedOn: string;
  dueOn: string;
  companyId?: string;
  dealId?: string;
  recurringServiceId?: string;
  notes?: string;
  /** Start as already sent. Default: draft. */
  sent?: boolean;
}

function cleanNumber(value: unknown): string {
  const text = cleanText(value, "number", 60, { required: true })!;
  return text.replace(/\s+/g, " ");
}

function cleanCurrency(value: unknown): string {
  const text = typeof value === "string" ? value.trim().toUpperCase() : "KES";
  if (!/^[A-Z]{3}$/.test(text)) throw new ValidationError("currency is not valid.", [{ path: "currency", message: "Use a three-letter code such as KES." }]);
  return text;
}

async function resolveInvoiceTarget(ctx: AuthContext, input: { companyId?: string; dealId?: string }) {
  let companyId = input.companyId;
  const dealId = input.dealId;
  if (dealId) {
    const deal = await getDealForInvoice(ctx.organizationId, dealId);
    if (!deal) throw new NotFoundError("Deal", dealId);
    if (deal.outcome !== "WON") {
      throw new ValidationError("An invoice can only be linked to a won deal.", [{ path: "dealId", message: "This deal is not won yet.", code: "DEAL_NOT_WON" }]);
    }
    if (companyId && companyId !== deal.companyId) {
      throw new ValidationError("The deal belongs to a different company.", [{ path: "companyId", message: "Use the deal's own company.", code: "COMPANY_MISMATCH" }]);
    }
    companyId = deal.companyId;
  }
  if (!companyId) {
    throw new ValidationError("A company or a won deal is required.", [{ path: "companyId", message: "Pick the company this invoice is for." }]);
  }
  const company = await getCompanyForInvoice(ctx.organizationId, companyId);
  if (!company) throw new NotFoundError("Company", companyId);
  if (company.archivedAt) {
    throw new ValidationError("This company is archived, so nothing can be added to it.", [{ path: "companyId", message: "Restore the company first.", code: "ARCHIVED_READ_ONLY" }]);
  }
  return { companyId, dealId: dealId ?? null };
}

export async function createInvoice(ctx: AuthContext, input: InvoiceInput, now = new Date()) {
  requireManage(ctx);
  const number = cleanNumber(input.number);
  const amountCents = parseMoneyCents(input.amount, "amount");
  const issuedOn = parseDateOnly(input.issuedOn, "issuedOn");
  const dueOn = parseDateOnly(input.dueOn, "dueOn");
  if (dueOn < issuedOn) throw new ValidationError("The due date is before the issue date.", [{ path: "dueOn", message: "Due on or after the issue date." }]);
  const notes = cleanText(input.notes, "notes", MAX_NOTES);
  const target = await resolveInvoiceTarget(ctx, input);
  if (await findInvoiceByNumber(ctx.organizationId, number)) {
    throw new ValidationError("An invoice with this number already exists.", [{ path: "number", message: "Pick a different number.", code: "DUPLICATE_INVOICE_NUMBER" }]);
  }
  const row = await insertInvoice({
    organizationId: ctx.organizationId,
    number,
    amount: fromCents(amountCents),
    currency: cleanCurrency(input.currency),
    issuedOn,
    dueOn,
    status: input.sent ? "SENT" : "DRAFT",
    dealId: target.dealId,
    companyId: target.companyId,
    recurringServiceId: input.recurringServiceId ?? null,
    notes,
    createdByMembershipId: ctx.membershipId,
  });
  const detail = await invoiceDetail(ctx.organizationId, row.id, now);
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "invoice.created",
    entityType: "Invoice",
    entityId: row.id,
    newValue: snapshot(detail),
  });
  return detail;
}

export async function getInvoice(ctx: AuthContext, invoiceId: string, now = new Date()) {
  requireView(ctx);
  return invoiceDetail(ctx.organizationId, invoiceId, now);
}

export async function updateInvoice(
  ctx: AuthContext,
  invoiceId: string,
  patch: { number?: string; amount?: number | string; dueOn?: string; issuedOn?: string; notes?: string | null },
  now = new Date(),
) {
  requireManage(ctx);
  const before = await invoiceDetail(ctx.organizationId, invoiceId, now);
  if (before.storedStatus === "VOID") {
    throw new ValidationError("A void invoice cannot be changed.", [{ path: "status", message: "This invoice is void.", code: "INVOICE_VOID" }]);
  }
  const data: Prisma.InvoiceUncheckedUpdateInput = {};
  if (patch.number !== undefined) {
    const number = cleanNumber(patch.number);
    if (number.toLowerCase() !== before.number.toLowerCase() && (await findInvoiceByNumber(ctx.organizationId, number))) {
      throw new ValidationError("An invoice with this number already exists.", [{ path: "number", message: "Pick a different number.", code: "DUPLICATE_INVOICE_NUMBER" }]);
    }
    data.number = number;
  }
  const issuedOn = patch.issuedOn !== undefined ? parseDateOnly(patch.issuedOn, "issuedOn") : before.issuedOn;
  const dueOn = patch.dueOn !== undefined ? parseDateOnly(patch.dueOn, "dueOn") : before.dueOn;
  if (dueOn < issuedOn) throw new ValidationError("The due date is before the issue date.", [{ path: "dueOn", message: "Due on or after the issue date." }]);
  if (patch.issuedOn !== undefined) data.issuedOn = issuedOn;
  if (patch.dueOn !== undefined) data.dueOn = dueOn;
  if (patch.notes !== undefined) data.notes = cleanText(patch.notes, "notes", MAX_NOTES);
  if (patch.amount !== undefined) {
    const amountCents = parseMoneyCents(patch.amount, "amount");
    const paidCents = toCents(before.paidAmount);
    if (amountCents < paidCents && !before.allowOverpayment) {
      throw new ValidationError(`The amount is less than the ${before.paidAmount} already received.`, [
        { path: "amount", message: "Reverse a payment first, or keep the amount at or above what was received.", code: "AMOUNT_BELOW_PAID" },
      ]);
    }
    data.amount = fromCents(amountCents);
    data.status = statusAfterPayments(before.storedStatus, amountCents, paidCents);
  }
  await withLockedInvoice(ctx.organizationId, invoiceId, (tx) => tx.invoice.update({ where: { id: invoiceId, organizationId: ctx.organizationId }, data }));
  const after = await invoiceDetail(ctx.organizationId, invoiceId, now);
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "invoice.updated",
    entityType: "Invoice",
    entityId: invoiceId,
    previousValue: snapshot(before),
    newValue: snapshot(after),
  });
  return after;
}

export async function markInvoiceSent(ctx: AuthContext, invoiceId: string, now = new Date()) {
  requireManage(ctx);
  const before = await invoiceDetail(ctx.organizationId, invoiceId, now);
  if (before.storedStatus === "SENT") return before;
  if (before.storedStatus !== "DRAFT") {
    throw new ValidationError("Only a draft invoice can be marked as sent.", [{ path: "status", message: `This invoice is ${before.storedStatus.toLowerCase().replace("_", " ")}.`, code: "INVOICE_NOT_DRAFT" }]);
  }
  await withLockedInvoice(ctx.organizationId, invoiceId, (tx) => tx.invoice.update({ where: { id: invoiceId, organizationId: ctx.organizationId }, data: { status: "SENT" } }));
  const after = await invoiceDetail(ctx.organizationId, invoiceId, now);
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "invoice.sent",
    entityType: "Invoice",
    entityId: invoiceId,
    previousValue: snapshot(before),
    newValue: snapshot(after),
  });
  return after;
}

/** Voiding keeps the invoice and its history; it is refused while money is still recorded against it. */
export async function voidInvoice(ctx: AuthContext, invoiceId: string, input: { reason: string }, now = new Date()) {
  requireManage(ctx);
  const reason = cleanText(input.reason, "reason", 300, { required: true })!;
  const before = await invoiceDetail(ctx.organizationId, invoiceId, now);
  if (before.storedStatus === "VOID") return before;
  if (toCents(before.paidAmount) > 0) {
    throw new ValidationError("This invoice has payments recorded. Reverse them before voiding it.", [{ path: "status", message: "Payments are recorded.", code: "INVOICE_HAS_PAYMENTS" }]);
  }
  await withLockedInvoice(ctx.organizationId, invoiceId, (tx) =>
    tx.invoice.update({
      where: { id: invoiceId, organizationId: ctx.organizationId },
      data: { status: "VOID", voidedAt: now, voidReason: reason, voidedByMembershipId: ctx.membershipId },
    }),
  );
  const after = await invoiceDetail(ctx.organizationId, invoiceId, now);
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "invoice.voided",
    entityType: "Invoice",
    entityId: invoiceId,
    previousValue: snapshot(before),
    newValue: snapshot(after),
    metadata: { reason },
  });
  return after;
}

// ---------------------------------------------------------------------------
// Payments received
// ---------------------------------------------------------------------------

export async function recordPayment(
  ctx: AuthContext,
  invoiceId: string,
  input: { amount: number | string; paidOn?: string; methodLabel?: string; reference?: string; allowOverpayment?: boolean },
  now = new Date(),
) {
  requireManage(ctx);
  const paymentCents = parseMoneyCents(input.amount, "amount");
  const paidOn = input.paidOn ? parseDateOnly(input.paidOn, "paidOn") : startOfDay(now);
  if (paidOn.getTime() > startOfDay(now).getTime() + 24 * 60 * 60 * 1000) {
    throw new ValidationError("A payment cannot be dated in the future.", [{ path: "paidOn", message: "Use today or an earlier date.", code: "FUTURE_PAYMENT" }]);
  }
  const methodLabel = cleanText(input.methodLabel, "methodLabel", 60);
  const reference = cleanText(input.reference, "reference", 120);

  const before = await invoiceDetail(ctx.organizationId, invoiceId, now);
  const payment = await withLockedInvoice(ctx.organizationId, invoiceId, async (tx) => {
    const invoice = await tx.invoice.findFirst({ where: { id: invoiceId, organizationId: ctx.organizationId } });
    if (!invoice) throw new NotFoundError("Invoice", invoiceId);
    const amountCents = toCents(invoice.amount);
    const paidCents = await activePaidCents(tx, ctx.organizationId, invoiceId);
    const check = checkNewPayment({ status: invoice.status, amountCents, paidCents, paymentCents, allowOverpayment: input.allowOverpayment === true || invoice.allowOverpayment });
    if (!check.ok) throw new ValidationError(check.message, [{ path: "amount", message: check.message, code: check.code }]);
    const created = await tx.paymentRecord.create({
      data: { organizationId: ctx.organizationId, invoiceId, amount: fromCents(paymentCents), paidOn, methodLabel, reference, recordedByMembershipId: ctx.membershipId },
    });
    await tx.invoice.update({
      where: { id: invoiceId, organizationId: ctx.organizationId },
      data: {
        status: statusAfterPayments(invoice.status, amountCents, check.paidCents),
        ...(check.paidCents > amountCents ? { allowOverpayment: true } : {}),
      },
    });
    return created;
  });
  const after = await invoiceDetail(ctx.organizationId, invoiceId, now);
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "payment.recorded",
    entityType: "PaymentRecord",
    entityId: payment.id,
    previousValue: { invoiceStatus: before.storedStatus, paidAmount: before.paidAmount },
    newValue: { invoiceId, amount: money(payment.amount), paidOn, invoiceStatus: after.storedStatus, paidAmount: after.paidAmount },
  });
  return after;
}

/** A payment recorded by mistake is reversed with a reason; the record stays. */
export async function reversePayment(ctx: AuthContext, paymentId: string, input: { reason: string }, now = new Date()) {
  requireManage(ctx);
  const reason = cleanText(input.reason, "reason", 300, { required: true })!;
  const record = await adminDb.paymentRecord.findFirst({ where: { id: paymentId, organizationId: ctx.organizationId } });
  if (!record) throw new NotFoundError("PaymentRecord", paymentId);
  if (record.reversedAt) return invoiceDetail(ctx.organizationId, record.invoiceId, now);
  const before = await invoiceDetail(ctx.organizationId, record.invoiceId, now);
  if (before.storedStatus === "VOID") {
    throw new ValidationError("This invoice is void.", [{ path: "status", message: "A void invoice cannot change.", code: "INVOICE_VOID" }]);
  }
  await withLockedInvoice(ctx.organizationId, record.invoiceId, async (tx) => {
    const invoice = await tx.invoice.findFirstOrThrow({ where: { id: record.invoiceId, organizationId: ctx.organizationId } });
    await tx.paymentRecord.update({
      where: { id: paymentId, organizationId: ctx.organizationId },
      data: { reversedAt: now, reversalReason: reason, reversedByMembershipId: ctx.membershipId },
    });
    const paidCents = await activePaidCents(tx, ctx.organizationId, record.invoiceId);
    await tx.invoice.update({
      where: { id: record.invoiceId, organizationId: ctx.organizationId },
      data: { status: statusAfterPayments(invoice.status, toCents(invoice.amount), paidCents) },
    });
  });
  const after = await invoiceDetail(ctx.organizationId, record.invoiceId, now);
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "payment.reversed",
    entityType: "PaymentRecord",
    entityId: paymentId,
    previousValue: { invoiceStatus: before.storedStatus, paidAmount: before.paidAmount },
    newValue: { invoiceId: record.invoiceId, amount: money(record.amount), invoiceStatus: after.storedStatus, paidAmount: after.paidAmount },
    metadata: { reason },
  });
  return after;
}

// ---------------------------------------------------------------------------
// Lists, totals, export
// ---------------------------------------------------------------------------

export interface InvoiceFilters {
  status?: string;
  /** Shortcut for status OVERDUE. */
  overdue?: boolean;
  companyId?: string;
  dealId?: string;
  dueFrom?: string;
  dueTo?: string;
  q?: string;
}

function whereFor(filters: InvoiceFilters, today: Date): Prisma.InvoiceWhereInput {
  const and: Prisma.InvoiceWhereInput[] = [];
  const status = filters.overdue ? "OVERDUE" : filters.status;
  if (status) {
    if (!(INVOICE_STATUSES as readonly string[]).includes(status)) {
      throw new ValidationError(`Unknown status "${status}".`, [{ path: "status", message: `Use one of ${INVOICE_STATUSES.join(", ")}.` }]);
    }
    const day = startOfDay(today);
    if (status === "OVERDUE") and.push({ status: { in: ["SENT", "PART_PAID"] }, dueOn: { lt: day } });
    else if (status === "SENT" || status === "PART_PAID") and.push({ status: status as "SENT" | "PART_PAID", dueOn: { gte: day } });
    else and.push({ status: status as "DRAFT" | "PAID" | "VOID" });
  }
  if (filters.companyId) and.push({ companyId: filters.companyId });
  if (filters.dealId) and.push({ dealId: filters.dealId });
  if (filters.dueFrom) and.push({ dueOn: { gte: parseDateOnly(filters.dueFrom, "dueFrom") } });
  if (filters.dueTo) and.push({ dueOn: { lte: parseDateOnly(filters.dueTo, "dueTo") } });
  const q = filters.q?.trim();
  if (q) and.push({ OR: [{ number: { contains: q, mode: "insensitive" } }, { company: { name: { contains: q, mode: "insensitive" } } }] });
  return and.length > 0 ? { AND: and } : {};
}

function orderFor(sort: string | undefined): Prisma.InvoiceOrderByWithRelationInput[] {
  const spec = parseSort(sort, INVOICE_SORT_FIELDS);
  const primary = spec ?? { field: "dueOn" as const, direction: "asc" as const };
  return [{ [primary.field]: primary.direction }, { id: "asc" }];
}

export async function listInvoices(ctx: AuthContext, filters: InvoiceFilters = {}, request: PageRequest & { sort?: string } = {}, now = new Date()) {
  requireView(ctx);
  const paging = resolvePaging(request);
  const where = whereFor(filters, now);
  const { rows, total } = await listInvoiceRows(ctx.organizationId, where, orderFor(request.sort), paging.skip, paging.take);
  const totals = await statusTotals(ctx.organizationId, startOfDay(now), {
    companyId: filters.companyId,
    dealId: filters.dealId,
    dueFrom: filters.dueFrom ? parseDateOnly(filters.dueFrom, "dueFrom") : undefined,
    dueTo: filters.dueTo ? parseDateOnly(filters.dueTo, "dueTo") : undefined,
  });
  const byStatus: Record<string, { count: number; amount: string; outstanding: string }> = {};
  for (const s of INVOICE_STATUSES) byStatus[s] = { count: 0, amount: "0.00", outstanding: "0.00" };
  for (const row of totals) byStatus[row.status] = { count: row.count, amount: row.amount, outstanding: row.outstanding };
  const outstanding = Object.entries(byStatus)
    .filter(([s]) => s !== "VOID")
    .reduce((sum, [, v]) => sum + toCents(v.outstanding), 0);
  return {
    ...buildPage(rows.map((r) => toInvoiceView(r, now)), total, paging),
    totals: { byStatus, outstanding: fromCents(outstanding), nothingToCollect: outstanding === 0 },
  };
}

const CSV_COLUMNS = ["number", "company", "dealId", "status", "currency", "amount", "paid", "balance", "issuedOn", "dueOn", "daysOverdue"] as const;

/** CSV of the invoices matching the filters. Over the bulk limit it needs `export.bulk` (Management), like every export. */
export async function exportInvoicesCsv(ctx: AuthContext, filters: InvoiceFilters = {}, now = new Date()): Promise<string> {
  requireView(ctx);
  requireManage(ctx);
  const where = whereFor(filters, now);
  const rows = await listAllInvoiceRows(ctx.organizationId, where, orderFor(undefined), MAX_INVOICE_EXPORT_ROWS);
  await assertBulkExportAllowed(ctx, rows.length);
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "invoices.exported",
    entityType: "Invoice",
    metadata: { rows: rows.length, filters: JSON.parse(JSON.stringify(filters)) },
  });
  return stringify(
    rows.map((r) => {
      const v = toInvoiceView(r, now);
      return {
        number: v.number,
        company: v.companyName,
        dealId: v.dealId ?? "",
        status: v.status,
        currency: v.currency,
        amount: v.amount,
        paid: v.paidAmount,
        balance: v.balance,
        issuedOn: v.issuedOn.toISOString().slice(0, 10),
        dueOn: v.dueOn.toISOString().slice(0, 10),
        daysOverdue: v.daysOverdue,
      };
    }),
    { header: true, columns: [...CSV_COLUMNS] },
  );
}

// ---------------------------------------------------------------------------
// Finance dashboard numbers
// ---------------------------------------------------------------------------

export async function getPaymentAggregates(ctx: AuthContext, now = new Date()) {
  requireView(ctx);
  return paymentAggregatesFor(ctx.organizationId, now);
}

/** Also used by the Finance dashboard section, which has already checked the caller's permission. */
export async function paymentAggregatesFor(organizationId: string, now = new Date()) {
  const today = startOfDay(now);
  const weekEnd = new Date(today.getTime() + 6 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const nextMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
  const [agg, collected] = await Promise.all([paymentAggregates(organizationId, today, weekEnd), collectedBetween(organizationId, monthStart, nextMonth)]);
  const nothingToCollect = toCents(agg.outstandingTotal) === 0;
  return {
    dueThisWeek: { count: agg.dueThisWeekCount, outstanding: agg.dueThisWeekOutstanding },
    overdue: { count: agg.overdueCount, outstanding: agg.overdueOutstanding, oldestDaysOverdue: agg.oldestDaysOverdue },
    collectedThisMonth: { count: collected.count, amount: collected.amount },
    outstanding: agg.outstandingTotal,
    nothingToCollect,
  };
}

// ---------------------------------------------------------------------------
// The "next" note on a won deal
// ---------------------------------------------------------------------------

async function wonDealOrThrow(ctx: AuthContext, dealId: string) {
  const deal = await getDealForInvoice(ctx.organizationId, dealId);
  if (!deal) throw new NotFoundError("Deal", dealId);
  if (deal.outcome !== "WON") {
    throw new ValidationError("A follow-up note belongs to a won deal.", [{ path: "dealId", message: "This deal is not won yet.", code: "DEAL_NOT_WON" }]);
  }
  return deal;
}

export async function getDealNextNote(ctx: AuthContext, dealId: string) {
  requireView(ctx);
  await wonDealOrThrow(ctx, dealId);
  const note = await getPaymentNote(ctx.organizationId, dealId);
  return note ? { dealId, note: note.note, ownerMembershipId: note.ownerMembershipId, nextOn: note.nextOn, updatedAt: note.updatedAt } : null;
}

export async function setDealNextNote(ctx: AuthContext, dealId: string, input: { note: string; ownerMembershipId?: string | null; nextOn?: string | null }) {
  requireView(ctx);
  if (!canWriteNote(ctx)) requirePermission(ctx, "finance.followup.note");
  await wonDealOrThrow(ctx, dealId);
  const note = cleanText(input.note, "note", MAX_NOTES, { required: true })!;
  const nextOn = parseOptionalDate(input.nextOn, "nextOn");
  const ownerMembershipId = input.ownerMembershipId === undefined ? ctx.membershipId : input.ownerMembershipId;
  if (ownerMembershipId) {
    const owner = await adminDb.membership.findFirst({ where: { id: ownerMembershipId, organizationId: ctx.organizationId, status: "ACTIVE" }, select: { id: true } });
    if (!owner) throw new ValidationError("The owner is not an active member.", [{ path: "ownerMembershipId", message: "Pick an active member." }]);
  }
  const before = await getPaymentNote(ctx.organizationId, dealId);
  const saved = await upsertPaymentNote({ organizationId: ctx.organizationId, dealId, note, ownerMembershipId, nextOn, updatedByMembershipId: ctx.membershipId });
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: before ? "deal_payment_note.updated" : "deal_payment_note.created",
    entityType: "DealPaymentNote",
    entityId: saved.id,
    previousValue: before ? { note: before.note, ownerMembershipId: before.ownerMembershipId, nextOn: before.nextOn } : undefined,
    newValue: { dealId, note, ownerMembershipId, nextOn },
  });
  return { dealId, note: saved.note, ownerMembershipId: saved.ownerMembershipId, nextOn: saved.nextOn, updatedAt: saved.updatedAt };
}

export async function clearDealNextNote(ctx: AuthContext, dealId: string) {
  requireView(ctx);
  if (!canWriteNote(ctx)) requirePermission(ctx, "finance.followup.note");
  await wonDealOrThrow(ctx, dealId);
  const before = await getPaymentNote(ctx.organizationId, dealId);
  if (!before) return { dealId, cleared: false };
  await deletePaymentNote(ctx.organizationId, dealId);
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "deal_payment_note.cleared",
    entityType: "DealPaymentNote",
    entityId: before.id,
    previousValue: { note: before.note, ownerMembershipId: before.ownerMembershipId, nextOn: before.nextOn },
  });
  return { dealId, cleared: true };
}

/** Won deals with what has been invoiced and received, and the next note: the tracker's "by deal" view. */
export async function listWonDealPayments(ctx: AuthContext, request: PageRequest & { companyId?: string } = {}, now = new Date()) {
  requireView(ctx);
  const paging = resolvePaging(request);
  const { rows, total } = await listWonDealRows(ctx.organizationId, paging.skip, paging.take, request.companyId);
  const items = rows.map((deal) => {
    let invoiced = 0;
    let received = 0;
    let overdue = 0;
    for (const inv of deal.invoices) {
      const s = standingOf(
        { status: inv.status, amountCents: toCents(inv.amount), paidCents: inv.payments.reduce((sum, p) => sum + toCents(p.amount), 0), dueOn: inv.dueOn },
        now,
      );
      invoiced += toCents(inv.amount);
      received += s.paidCents;
      if (s.overdue) overdue += 1;
    }
    const note = deal.paymentNotes[0] ?? null;
    return {
      dealId: deal.id,
      companyId: deal.companyId,
      companyName: deal.company.name,
      serviceName: deal.service?.name ?? null,
      dealValue: deal.value ? money(deal.value) : null,
      currency: deal.currency,
      wonAt: deal.wonAt,
      invoiced: fromCents(invoiced),
      received: fromCents(received),
      outstanding: fromCents(Math.max(0, invoiced - received)),
      invoiceCount: deal.invoices.length,
      overdueInvoices: overdue,
      state: deal.invoices.length === 0 ? "NOT_INVOICED" : overdue > 0 ? "OVERDUE" : invoiced - received <= 0 ? "PAID_IN_FULL" : "AWAITING_PAYMENT",
      nextNote: note ? { note: note.note, ownerMembershipId: note.ownerMembershipId, nextOn: note.nextOn } : null,
    };
  });
  return buildPage(items, total, paging);
}

// ---------------------------------------------------------------------------
// Overdue reminders (run by the daily job)
// ---------------------------------------------------------------------------

/**
 * One reminder per overdue invoice and due date, to Finance (or Management when there is no Finance member) and to the
 * owner of the deal. The deal owner's message carries no amount, because payments are visible to Finance and
 * Management only. Safe to run repeatedly: the notification is keyed on the invoice and its due date.
 */
export async function raiseOverdueInvoiceReminders(organizationId: string, now = new Date()): Promise<{ invoices: number; notified: number }> {
  const today = startOfDay(now);
  const overdue = await adminDb.invoice.findMany({
    where: { organizationId, status: { in: ["SENT", "PART_PAID"] }, dueOn: { lt: today } },
    select: { id: true, number: true, dueOn: true, amount: true, currency: true, company: { select: { name: true } }, deal: { select: { id: true, ownerMembershipId: true } } },
  });
  if (overdue.length === 0) return { invoices: 0, notified: 0 };
  const org = await adminDb.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { slug: true } });
  const financeIds = await membershipIdsWithRole(organizationId, "FINANCE");
  const recipients = financeIds.length > 0 ? financeIds : await membershipIdsWithRole(organizationId, "MANAGEMENT");
  let notified = 0;
  for (const inv of overdue) {
    const entityId = `${inv.id}:${inv.dueOn.toISOString().slice(0, 10)}`;
    const days = Math.round((today.getTime() - startOfDay(inv.dueOn).getTime()) / (24 * 60 * 60 * 1000));
    const path = `/o/${org.slug}/payments?invoice=${inv.id}`;
    for (const membershipId of recipients) {
      await notifyEvent({
        organizationId,
        membershipId,
        type: "PAYMENT_OVERDUE",
        title: `Invoice ${inv.number} is overdue`,
        body: `${inv.company.name}: ${inv.currency} ${fromCents(toCents(inv.amount))} was due ${days} day${days === 1 ? "" : "s"} ago.`,
        entityType: "Invoice",
        entityId,
        path,
      });
      notified += 1;
    }
    const ownerId = inv.deal?.ownerMembershipId;
    if (ownerId && !recipients.includes(ownerId)) {
      await notifyEvent({
        organizationId,
        membershipId: ownerId,
        type: "PAYMENT_OVERDUE",
        title: `A payment from ${inv.company.name} is overdue`,
        // No invoice number and no amount: payments are visible to Finance and Management only, so the owner is told that
        // something is late and nothing about the invoice itself.
        body: `A payment passed its due date ${days} day${days === 1 ? "" : "s"} ago. Finance is following up; a word from you may help.`,
        entityType: "Invoice",
        entityId,
        path: `/o/${org.slug}/deals/${inv.deal!.id}`,
      });
      notified += 1;
    }
    // The run log (B4.02) says that the notice went out, and never carries the invoice number or the amount.
    await logRuleRun(
      { organizationId, ruleKey: RULE_KEYS.OVERDUE_INVOICE_NOTICE, triggerKey: `invoice:${entityId}`, entityType: "Invoice", entityId: inv.id },
      "APPLIED",
      { result: `Told Finance${ownerId && !recipients.includes(ownerId) ? " and the deal owner" : ""} that an invoice was ${days} day${days === 1 ? "" : "s"} overdue.` },
    ).catch(() => undefined);
  }
  return { invoices: overdue.length, notified };
}

async function membershipIdsWithRole(organizationId: string, roleKey: string): Promise<string[]> {
  const rows = await adminDb.membership.findMany({ where: { organizationId, status: "ACTIVE", role: { key: roleKey } }, select: { id: true } });
  return rows.map((r) => r.id);
}

export type { InvoiceStatus };
