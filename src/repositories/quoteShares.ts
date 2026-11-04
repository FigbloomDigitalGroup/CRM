import type { Prisma } from "@prisma/client";
import { adminDb } from "../db/adminClient";
import { withOrgContext } from "../db/orgScopedClient";

/** Data access for `quote_shares` and `quote_events` (FIG-1144). Everything runs in the organisation's RLS context, except the public token lookup. */

export function createShare(data: Prisma.QuoteShareUncheckedCreateInput) {
  return withOrgContext(data.organizationId, (tx) => tx.quoteShare.create({ data }));
}

export function listShares(organizationId: string, quoteVersionId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.quoteShare.findMany({
      where: { organizationId, quoteVersionId },
      orderBy: { createdAt: "desc" },
      select: { id: true, recipientEmail: true, expiresAt: true, revokedAt: true, viewCount: true, firstViewedAt: true, lastViewedAt: true, createdAt: true, createdByMembershipId: true, documentSha256: true },
    }),
  );
}

export function getShare(organizationId: string, id: string) {
  return withOrgContext(organizationId, (tx) => tx.quoteShare.findFirst({ where: { organizationId, id } }));
}

/** The latest share of a version, document included (the preview of a sent version is that document). */
export function latestShareWithDocument(organizationId: string, quoteVersionId: string) {
  return withOrgContext(organizationId, (tx) => tx.quoteShare.findFirst({ where: { organizationId, quoteVersionId }, orderBy: { createdAt: "asc" } }));
}

export function revokeShare(organizationId: string, id: string, now: Date) {
  return withOrgContext(organizationId, async (tx) => {
    const res = await tx.quoteShare.updateMany({ where: { id, organizationId, revokedAt: null }, data: { revokedAt: now } });
    return res.count === 1;
  });
}

/**
 * The public lookup by token hash. This is the one query that runs before any organisation is known, so it uses the owner
 * connection; everything after it runs scoped to the organisation the link belongs to.
 */
export function findShareByTokenHash(tokenHash: string) {
  return adminDb.quoteShare.findUnique({ where: { tokenHash } });
}

export function recordView(organizationId: string, shareId: string, now: Date, timeline: boolean) {
  return withOrgContext(organizationId, async (tx) => {
    const share = await tx.quoteShare.update({
      where: { id: shareId, organizationId },
      data: { viewCount: { increment: 1 }, lastViewedAt: now, ...(timeline ? { lastTimelineAt: now } : {}) },
    });
    if (share.firstViewedAt === null) {
      await tx.quoteShare.update({ where: { id: shareId, organizationId }, data: { firstViewedAt: now } });
    }
    return share;
  });
}

export function addEvent(data: Prisma.QuoteEventUncheckedCreateInput) {
  return withOrgContext(data.organizationId, (tx) => tx.quoteEvent.create({ data }));
}

export function listEvents(organizationId: string, quoteVersionId: string) {
  return withOrgContext(organizationId, (tx) => tx.quoteEvent.findMany({ where: { organizationId, quoteVersionId }, orderBy: { occurredAt: "asc" } }));
}
