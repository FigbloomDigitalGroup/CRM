import { Prisma } from "@prisma/client";
import { withOrgContext, type OrgScopedClient } from "../db/orgScopedClient";

/** Data access for `quotes`, `quote_versions` and `quote_lines` (FIG-1143). Every call runs inside the organisation's RLS context. */

export interface NewLine {
  catalogueItemId: string | null;
  description: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  unitCost: number | null;
  taxable: boolean;
  lineTotal: number;
}

export interface VersionContent {
  discountPercent: number;
  validUntil: string;
  terms: string | null;
  subtotal: number;
  discountAmount: number;
  total: number;
  costTotal: number | null;
  /** UC-R5: the tax terms to store. Left out (undefined) on an edit of a draft, which keeps the terms the version already has; set when a version is made. */
  taxMode?: string;
  taxRateBp?: number | null;
  taxLabel?: string | null;
}

const withLines = { lines: { orderBy: { position: "asc" as const } } };

export function getQuoteByDeal(organizationId: string, dealId: string) {
  return withOrgContext(organizationId, (tx) => tx.quote.findFirst({ where: { organizationId, dealId }, include: { versions: { orderBy: { version: "asc" } } } }));
}

export function getQuoteById(organizationId: string, id: string) {
  return withOrgContext(organizationId, (tx) => tx.quote.findFirst({ where: { organizationId, id }, include: { versions: { orderBy: { version: "asc" } } } }));
}

export function getVersionWithLines(organizationId: string, quoteId: string, version: number) {
  return withOrgContext(organizationId, (tx) => tx.quoteVersion.findFirst({ where: { organizationId, quoteId, version }, include: withLines }));
}

export function getVersionById(organizationId: string, versionId: string) {
  return withOrgContext(organizationId, (tx) => tx.quoteVersion.findFirst({ where: { organizationId, id: versionId }, include: { ...withLines, quote: true } }));
}

/** UC-R3: the additive filters of the Quotes list. All are on the quote's latest version or its deal; none is a money value (rule 7). */
export interface QuoteListFilters {
  /** Text in the quote number, the customer's name or the deal's notes (case-insensitive). */
  q?: string;
  /** The deal's owner. */
  ownerMembershipId?: string;
  companyId?: string;
  /** The latest version's validity date, inclusive, `YYYY-MM-DD`. */
  validFrom?: string;
  validTo?: string;
  /** "only": the latest version is SENT or APPROVED and past its validity date (the derived "Expired"); "exclude": everything else. */
  expired?: "only" | "exclude";
  /** Today, `YYYY-MM-DD`: what "past its validity date" is measured against. */
  today?: string;
}

export const hasExtraQuoteFilters = (f: QuoteListFilters): boolean =>
  f.q !== undefined || f.ownerMembershipId !== undefined || f.companyId !== undefined || f.validFrom !== undefined || f.validTo !== undefined || f.expired !== undefined;

export interface QuoteStatusCounts {
  ALL: number;
  DRAFT: number;
  PENDING_APPROVAL: number;
  APPROVED: number;
  REJECTED: number;
  SENT: number;
  ACCEPTED: number;
  DECLINED: number;
  /** Derived: SENT or APPROVED and past the validity date. Counted here and not in APPROVED / SENT, so the chips add up to ALL. */
  EXPIRED: number;
}

/** The WHERE of the raw list queries: the organisation, the deals the caller may open, and every filter except the status ones. */
function quoteConditions(organizationId: string, dealIds: string[] | undefined, f: QuoteListFilters): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`q.organization_id = ${organizationId}`];
  if (dealIds) parts.push(dealIds.length === 0 ? Prisma.sql`false` : Prisma.sql`q.deal_id IN (${Prisma.join(dealIds)})`);
  if (f.companyId) parts.push(Prisma.sql`d.company_id = ${f.companyId}`);
  if (f.ownerMembershipId) parts.push(Prisma.sql`d.owner_membership_id = ${f.ownerMembershipId}`);
  if (f.validFrom) parts.push(Prisma.sql`v.valid_until >= ${f.validFrom}::date`);
  if (f.validTo) parts.push(Prisma.sql`v.valid_until <= ${f.validTo}::date`);
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    parts.push(Prisma.sql`(q.number ILIKE ${like} OR c.name ILIKE ${like} OR COALESCE(d.notes, '') ILIKE ${like})`);
  }
  return Prisma.join(parts, " AND ");
}

const LATEST_JOIN = Prisma.sql`FROM quotes q
  JOIN deals d ON d.id = q.deal_id AND d.organization_id = q.organization_id
  JOIN companies c ON c.id = d.company_id
  JOIN quote_versions v ON v.quote_id = q.id AND v.version = (SELECT max(v2.version) FROM quote_versions v2 WHERE v2.quote_id = q.id)`;

export function listQuotes(
  organizationId: string,
  /** `dealIds`: the deals the caller may open (undefined = all). `dealId`: the deal(s) asked for. Both given means the deals asked for that the caller may open. */
  filter: { dealIds?: string[]; dealId?: string | string[]; status?: string } & QuoteListFilters,
  paging: { skip: number; take: number },
  options: { counts?: boolean } = {},
) {
  const asked = filter.dealId === undefined ? undefined : Array.isArray(filter.dealId) ? filter.dealId : [filter.dealId];
  let dealIds = filter.dealIds;
  if (asked) {
    const allowed = dealIds ? new Set(dealIds) : null;
    dealIds = asked.filter((id) => !allowed || allowed.has(id));
  }
  const extra = hasExtraQuoteFilters(filter);
  const today = filter.today ?? new Date().toISOString().slice(0, 10);
  return withOrgContext(organizationId, async (tx) => {
    const where: Prisma.QuoteWhereInput = {
      organizationId,
      ...(dealIds ? { dealId: { in: dealIds } } : {}),
    };
    if (extra || options.counts) {
      // The database picks the quotes (latest version, deal, customer), counts them and pages the ids; the rows are then loaded by id.
      const base = quoteConditions(organizationId, dealIds, filter);
      const expiredSql = Prisma.sql`(v.status IN ('SENT', 'APPROVED') AND v.valid_until < ${today}::date)`;
      const picks: Prisma.Sql[] = [base];
      if (filter.status) picks.push(Prisma.sql`v.status::text = ${filter.status}`);
      if (filter.expired === "only") picks.push(expiredSql);
      if (filter.expired === "exclude") picks.push(Prisma.sql`NOT ${expiredSql}`);
      const picked = Prisma.join(picks, " AND ");
      const page = await tx.$queryRaw<{ id: string; total: bigint }[]>`
        SELECT q.id, count(*) OVER () AS total ${LATEST_JOIN} WHERE ${picked}
        ORDER BY q.updated_at DESC, q.id ASC OFFSET ${paging.skip} LIMIT ${paging.take}`;
      let total = page.length > 0 ? Number(page[0]!.total) : 0;
      if (page.length === 0 && paging.skip > 0) {
        total = Number((await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n ${LATEST_JOIN} WHERE ${picked}`)[0]!.n);
      }
      let statusCounts: QuoteStatusCounts | undefined;
      if (options.counts) {
        const grouped = await tx.$queryRaw<{ bucket: string; n: bigint }[]>`
          SELECT CASE WHEN ${expiredSql} THEN 'EXPIRED' ELSE v.status::text END AS bucket, count(*) AS n ${LATEST_JOIN} WHERE ${base} GROUP BY 1`;
        statusCounts = { ALL: 0, DRAFT: 0, PENDING_APPROVAL: 0, APPROVED: 0, REJECTED: 0, SENT: 0, ACCEPTED: 0, DECLINED: 0, EXPIRED: 0 };
        for (const g of grouped) {
          if (g.bucket in statusCounts) (statusCounts as unknown as Record<string, number>)[g.bucket] = Number(g.n);
          statusCounts.ALL += Number(g.n);
        }
      }
      const ids = page.map((r) => r.id);
      const found = await tx.quote.findMany({ where: { organizationId, id: { in: ids } }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
      const byId = new Map(found.map((r) => [r.id, r]));
      return { rows: ids.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => r !== undefined), total, statusCounts };
    }
    // The status filter is on the latest version of each quote; the database picks those quotes, then pages them.
    if (filter.status) {
      const ids = await tx.$queryRaw<{ id: string }[]>`
        SELECT q.id FROM quotes q JOIN quote_versions v ON v.quote_id = q.id
        WHERE q.organization_id = ${organizationId} AND v.status::text = ${filter.status}
          AND v.version = (SELECT max(v2.version) FROM quote_versions v2 WHERE v2.quote_id = q.id)`;
      where.id = { in: ids.map((r) => r.id) };
    }
    const [rows, total] = await Promise.all([
      tx.quote.findMany({ where, include: { versions: { orderBy: { version: "desc" }, take: 1 } }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], skip: paging.skip, take: paging.take }),
      tx.quote.count({ where }),
    ]);
    return { rows, total, statusCounts: undefined as QuoteStatusCounts | undefined };
  });
}

/** Any version of a deal's quote that is APPROVED, SENT or ACCEPTED and still valid on `today` (the Proposal Sent gate). */
export function findValidQuoteVersion(organizationId: string, dealId: string, today: string) {
  return withOrgContext(organizationId, async (tx) => {
    const quote = await tx.quote.findFirst({ where: { organizationId, dealId }, select: { id: true } });
    if (!quote) return { hasQuote: false as const, valid: null, latest: null };
    const versions = await tx.quoteVersion.findMany({ where: { organizationId, quoteId: quote.id }, orderBy: { version: "desc" }, select: { version: true, status: true, validUntil: true } });
    const valid = versions.find((v) => ["APPROVED", "SENT", "ACCEPTED"].includes(v.status) && v.validUntil.toISOString().slice(0, 10) >= today) ?? null;
    return { hasQuote: true as const, valid, latest: versions[0] ?? null, versions };
  });
}

async function nextNumber(tx: OrgScopedClient, organizationId: string, year: number): Promise<string> {
  // One number at a time per organisation; the unique index is the backstop.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quote-number:${organizationId}`}))`;
  const prefix = `Q-${year}-`;
  const last = await tx.quote.findFirst({ where: { organizationId, number: { startsWith: prefix } }, orderBy: { number: "desc" }, select: { number: true } });
  const n = last ? Number(last.number.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(n).padStart(4, "0")}`;
}

export function createQuoteWithFirstVersion(input: {
  organizationId: string;
  dealId: string;
  currency: string;
  createdByMembershipId: string;
  content: VersionContent;
  lines: NewLine[];
  year: number;
}) {
  return withOrgContext(input.organizationId, async (tx) => {
    const number = await nextNumber(tx, input.organizationId, input.year);
    const quote = await tx.quote.create({
      data: { organizationId: input.organizationId, dealId: input.dealId, number, currency: input.currency, createdByMembershipId: input.createdByMembershipId },
    });
    const version = await tx.quoteVersion.create({
      data: {
        organizationId: input.organizationId,
        quoteId: quote.id,
        version: 1,
        currency: input.currency,
        createdByMembershipId: input.createdByMembershipId,
        ...contentData(input.content),
        lines: { create: input.lines.map((l, i) => lineData(input.organizationId, l, i)) },
      },
      include: withLines,
    });
    return { quote, version };
  });
}

function contentData(c: VersionContent) {
  return {
    discountPercent: c.discountPercent,
    validUntil: new Date(`${c.validUntil}T00:00:00Z`),
    terms: c.terms,
    subtotal: c.subtotal,
    discountAmount: c.discountAmount,
    total: c.total,
    costTotal: c.costTotal,
    ...(c.taxMode !== undefined ? { taxMode: c.taxMode } : {}),
    ...(c.taxRateBp !== undefined ? { taxRateBp: c.taxRateBp } : {}),
    ...(c.taxLabel !== undefined ? { taxLabel: c.taxLabel } : {}),
  };
}

function lineData(organizationId: string, l: NewLine, position: number) {
  return { organizationId, position, catalogueItemId: l.catalogueItemId, description: l.description, unit: l.unit, quantity: l.quantity, unitPrice: l.unitPrice, unitCost: l.unitCost, taxable: l.taxable, lineTotal: l.lineTotal };
}

/** Replaces a DRAFT version's content and lines. The database refuses it for a locked version. */
export function replaceDraftContent(organizationId: string, versionId: string, content: VersionContent, lines: NewLine[] | null) {
  return withOrgContext(organizationId, async (tx) => {
    if (lines) {
      await tx.quoteLine.deleteMany({ where: { organizationId, quoteVersionId: versionId } });
      if (lines.length > 0) await tx.quoteLine.createMany({ data: lines.map((l, i) => ({ ...lineData(organizationId, l, i), quoteVersionId: versionId })) });
    }
    await tx.quoteVersion.update({ where: { id: versionId, organizationId }, data: contentData(content) });
    await tx.quote.updateMany({ where: { organizationId, versions: { some: { id: versionId } } }, data: { updatedAt: new Date() } });
    return tx.quoteVersion.findFirstOrThrow({ where: { id: versionId, organizationId }, include: withLines });
  });
}

export function createNextVersion(input: {
  organizationId: string;
  quoteId: string;
  version: number;
  currency: string;
  createdByMembershipId: string;
  content: VersionContent;
  lines: NewLine[];
}) {
  return withOrgContext(input.organizationId, async (tx) => {
    const created = await tx.quoteVersion.create({
      data: {
        organizationId: input.organizationId,
        quoteId: input.quoteId,
        version: input.version,
        currency: input.currency,
        createdByMembershipId: input.createdByMembershipId,
        ...contentData(input.content),
        lines: { create: input.lines.map((l, i) => lineData(input.organizationId, l, i)) },
      },
      include: withLines,
    });
    await tx.quote.update({ where: { id: input.quoteId, organizationId: input.organizationId }, data: { updatedAt: new Date() } });
    return created;
  });
}

/**
 * Moves a version to a new status only if it is currently in one of `from` (so two people cannot both decide it).
 * `lock` sets `locked_at` in the same statement. Returns the updated version, or null when it was not in `from`.
 */
export function transitionVersion(
  organizationId: string,
  versionId: string,
  from: string[],
  to: string,
  data: Prisma.QuoteVersionUncheckedUpdateManyInput & { lock?: boolean } = {},
) {
  const { lock, ...rest } = data;
  const now = new Date();
  return withOrgContext(organizationId, async (tx) => {
    const res = await tx.quoteVersion.updateMany({
      where: { id: versionId, organizationId, status: { in: from } },
      data: { ...rest, status: to, ...(lock ? { lockedAt: now } : {}) },
    });
    if (res.count !== 1) return null;
    return tx.quoteVersion.findFirstOrThrow({ where: { id: versionId, organizationId }, include: withLines });
  });
}
