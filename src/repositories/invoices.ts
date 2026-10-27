import { Prisma } from "@prisma/client";
import { withOrgContext, type OrgScopedClient } from "../db/orgScopedClient";

/**
 * Data access for `invoices`, `payment_records` and `deal_payment_notes` (FIG-1049, B3.03). Every call runs inside the
 * organisation's RLS context. Who may see any of it is decided in `paymentService`, never here.
 */

export type InvoiceWithPayments = Prisma.InvoiceGetPayload<{
  include: { payments: true; company: { select: { id: true; name: true } } };
}>;

export function getInvoiceRow(organizationId: string, id: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.invoice.findFirst({
      where: { id, organizationId },
      include: { payments: { orderBy: [{ paidOn: "asc" }, { createdAt: "asc" }] }, company: { select: { id: true, name: true } } },
    }),
  );
}

export function findInvoiceByNumber(organizationId: string, number: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.invoice.findFirst({ where: { organizationId, number: { equals: number, mode: "insensitive" } }, select: { id: true } }),
  );
}

export function insertInvoice(data: Prisma.InvoiceUncheckedCreateInput) {
  return withOrgContext(data.organizationId, (tx) => tx.invoice.create({ data }));
}

export function listInvoiceRows(
  organizationId: string,
  where: Prisma.InvoiceWhereInput,
  orderBy: Prisma.InvoiceOrderByWithRelationInput[],
  skip: number,
  take: number,
) {
  return withOrgContext(organizationId, async (tx) => {
    const [rows, total] = await Promise.all([
      tx.invoice.findMany({
        where: { ...where, organizationId },
        orderBy,
        skip,
        take,
        include: { payments: { where: { reversedAt: null } }, company: { select: { id: true, name: true } } },
      }),
      tx.invoice.count({ where: { ...where, organizationId } }),
    ]);
    return { rows, total };
  });
}

export function listAllInvoiceRows(organizationId: string, where: Prisma.InvoiceWhereInput, orderBy: Prisma.InvoiceOrderByWithRelationInput[], limit: number) {
  return withOrgContext(organizationId, (tx) =>
    tx.invoice.findMany({
      where: { ...where, organizationId },
      orderBy,
      take: limit,
      include: { payments: { where: { reversedAt: null } }, company: { select: { id: true, name: true } } },
    }),
  );
}

/** Runs `fn` with the invoice row locked, so two payments recorded at once cannot both fit under the amount. */
export function withLockedInvoice<T>(organizationId: string, invoiceId: string, fn: (tx: OrgScopedClient) => Promise<T>): Promise<T> {
  return withOrgContext(organizationId, async (tx) => {
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId} AND organization_id = ${organizationId} FOR UPDATE`;
    return fn(tx);
  });
}

export async function activePaidCents(tx: OrgScopedClient, organizationId: string, invoiceId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ cents: bigint | null }[]>`
    SELECT COALESCE(SUM(ROUND(amount * 100)), 0)::bigint AS cents
    FROM payment_records
    WHERE organization_id = ${organizationId} AND invoice_id = ${invoiceId} AND reversed_at IS NULL`;
  return Number(rows[0]?.cents ?? 0);
}

export interface TotalsFilter {
  companyId?: string;
  dealId?: string;
  dueFrom?: Date;
  dueTo?: Date;
}

export interface StatusTotalRow {
  status: string;
  count: number;
  amount: string;
  outstanding: string;
}

/** Count, amount and what is still owing, per derived status (overdue included), for the same filters as the list. */
export function statusTotals(organizationId: string, today: Date, filter: TotalsFilter) {
  const conditions: Prisma.Sql[] = [Prisma.sql`i.organization_id = ${organizationId}`];
  if (filter.companyId) conditions.push(Prisma.sql`i.company_id = ${filter.companyId}`);
  if (filter.dealId) conditions.push(Prisma.sql`i.deal_id = ${filter.dealId}`);
  if (filter.dueFrom) conditions.push(Prisma.sql`i.due_on >= ${filter.dueFrom}`);
  if (filter.dueTo) conditions.push(Prisma.sql`i.due_on <= ${filter.dueTo}`);
  return withOrgContext(organizationId, (tx) =>
    tx.$queryRaw<StatusTotalRow[]>`
      SELECT
        CASE WHEN i.status IN ('SENT', 'PART_PAID') AND i.due_on < ${today}::date THEN 'OVERDUE' ELSE i.status::text END AS status,
        count(*)::int AS count,
        COALESCE(SUM(i.amount), 0)::numeric(16,2)::text AS amount,
        COALESCE(SUM(GREATEST(i.amount - COALESCE(p.paid, 0), 0)) FILTER (WHERE i.status NOT IN ('VOID', 'DRAFT')), 0)::numeric(16,2)::text AS outstanding
      FROM invoices i
      LEFT JOIN (
        SELECT invoice_id, SUM(amount) AS paid FROM payment_records
        WHERE organization_id = ${organizationId} AND reversed_at IS NULL GROUP BY invoice_id
      ) p ON p.invoice_id = i.id
      WHERE ${Prisma.join(conditions, " AND ")}
      GROUP BY 1`,
  );
}

export interface PaymentAggregateRow {
  dueThisWeekCount: number;
  dueThisWeekOutstanding: string;
  overdueCount: number;
  overdueOutstanding: string;
  oldestDaysOverdue: number | null;
  outstandingTotal: string;
}

/** The Finance dashboard numbers (FIG-1050): due this week, overdue, still owing. */
export async function paymentAggregates(organizationId: string, today: Date, weekEnd: Date): Promise<PaymentAggregateRow> {
  const rows = await withOrgContext(organizationId, (tx) =>
    tx.$queryRaw<PaymentAggregateRow[]>`
      WITH owing AS (
        SELECT i.id, i.due_on, GREATEST(i.amount - COALESCE(p.paid, 0), 0) AS outstanding
        FROM invoices i
        LEFT JOIN (
          SELECT invoice_id, SUM(amount) AS paid FROM payment_records
          WHERE organization_id = ${organizationId} AND reversed_at IS NULL GROUP BY invoice_id
        ) p ON p.invoice_id = i.id
        WHERE i.organization_id = ${organizationId} AND i.status IN ('SENT', 'PART_PAID')
      )
      SELECT
        (count(*) FILTER (WHERE due_on >= ${today}::date AND due_on <= ${weekEnd}::date))::int AS "dueThisWeekCount",
        COALESCE(SUM(outstanding) FILTER (WHERE due_on >= ${today}::date AND due_on <= ${weekEnd}::date), 0)::numeric(16,2)::text AS "dueThisWeekOutstanding",
        (count(*) FILTER (WHERE due_on < ${today}::date))::int AS "overdueCount",
        COALESCE(SUM(outstanding) FILTER (WHERE due_on < ${today}::date), 0)::numeric(16,2)::text AS "overdueOutstanding",
        (${today}::date - MIN(due_on) FILTER (WHERE due_on < ${today}::date))::int AS "oldestDaysOverdue",
        COALESCE(SUM(outstanding), 0)::numeric(16,2)::text AS "outstandingTotal"
      FROM owing`,
  );
  return rows[0]!;
}

export async function collectedBetween(organizationId: string, from: Date, to: Date): Promise<{ count: number; amount: string }> {
  const rows = await withOrgContext(organizationId, (tx) =>
    tx.$queryRaw<{ count: number; amount: string }[]>`
      SELECT count(*)::int AS count, COALESCE(SUM(amount), 0)::numeric(16,2)::text AS amount
      FROM payment_records
      WHERE organization_id = ${organizationId} AND reversed_at IS NULL AND paid_on >= ${from}::date AND paid_on < ${to}::date`,
  );
  return rows[0]!;
}

export function getDealForInvoice(organizationId: string, dealId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.deal.findFirst({
      where: { id: dealId, organizationId },
      select: { id: true, companyId: true, outcome: true, archivedAt: true, ownerMembershipId: true },
    }),
  );
}

export function getCompanyForInvoice(organizationId: string, companyId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.company.findFirst({ where: { id: companyId, organizationId }, select: { id: true, name: true, archivedAt: true } }),
  );
}

export function getPaymentNote(organizationId: string, dealId: string) {
  return withOrgContext(organizationId, (tx) => tx.dealPaymentNote.findFirst({ where: { organizationId, dealId } }));
}

export function upsertPaymentNote(input: { organizationId: string; dealId: string; note: string; ownerMembershipId: string | null; nextOn: Date | null; updatedByMembershipId: string }) {
  const { organizationId, dealId, ...rest } = input;
  return withOrgContext(organizationId, (tx) =>
    tx.dealPaymentNote.upsert({
      where: { organizationId_dealId: { organizationId, dealId } },
      update: rest,
      create: { organizationId, dealId, ...rest },
    }),
  );
}

export function deletePaymentNote(organizationId: string, dealId: string) {
  return withOrgContext(organizationId, (tx) => tx.dealPaymentNote.deleteMany({ where: { organizationId, dealId } }));
}

export function listWonDealRows(organizationId: string, skip: number, take: number, companyId?: string) {
  return withOrgContext(organizationId, async (tx) => {
    const where = { organizationId, outcome: "WON" as const, archivedAt: null, ...(companyId ? { companyId } : {}) };
    const [rows, total] = await Promise.all([
      tx.deal.findMany({
        where,
        orderBy: [{ wonAt: "desc" }, { id: "asc" }],
        skip,
        take,
        select: {
          id: true,
          companyId: true,
          value: true,
          currency: true,
          wonAt: true,
          ownerMembershipId: true,
          company: { select: { name: true } },
          service: { select: { name: true } },
          paymentNotes: true,
          invoices: { where: { status: { notIn: ["VOID", "DRAFT"] } }, select: { id: true, amount: true, status: true, dueOn: true, payments: { where: { reversedAt: null }, select: { amount: true } } } },
        },
      }),
      tx.deal.count({ where }),
    ]);
    return { rows, total };
  });
}
