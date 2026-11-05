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

export function listQuotes(
  organizationId: string,
  filter: { dealIds?: string[]; dealId?: string; status?: string },
  paging: { skip: number; take: number },
) {
  return withOrgContext(organizationId, async (tx) => {
    const where: Prisma.QuoteWhereInput = {
      organizationId,
      ...(filter.dealId ? { dealId: filter.dealId } : {}),
      ...(filter.dealIds ? { dealId: { in: filter.dealIds } } : {}),
    };
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
    return { rows, total };
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
