import type { Prisma } from "@prisma/client";
import { withOrgContext } from "../db/orgScopedClient";

/** Data access for `approval_requests` (FIG-1145, B6.13). Every call runs inside the organisation's RLS context. */

export function createApprovalRequest(data: Prisma.ApprovalRequestUncheckedCreateInput) {
  return withOrgContext(data.organizationId, (tx) => tx.approvalRequest.create({ data }));
}

export function getApprovalRequest(organizationId: string, id: string) {
  return withOrgContext(organizationId, (tx) => tx.approvalRequest.findFirst({ where: { organizationId, id } }));
}

export function findPendingFor(organizationId: string, kind: string, subjectType: string, subjectId: string) {
  return withOrgContext(organizationId, (tx) => tx.approvalRequest.findFirst({ where: { organizationId, kind, subjectType, subjectId, status: "PENDING" } }));
}

/** The first `take` rows (newest first) and the count of everything the filter matches. */
export function pageApprovalRequests(organizationId: string, where: Prisma.ApprovalRequestWhereInput, take: number) {
  return withOrgContext(organizationId, async (tx) => {
    const full = { ...where, organizationId };
    const [rows, total] = await Promise.all([
      take > 0 ? tx.approvalRequest.findMany({ where: full, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take }) : Promise.resolve([]),
      tx.approvalRequest.count({ where: full }),
    ]);
    return { rows, total };
  });
}

/** Decides a PENDING request, once. Returns the decided row, or null when it was no longer pending (someone else decided first). */
export function decidePending(
  organizationId: string,
  id: string,
  status: "APPROVED" | "REJECTED" | "CANCELLED",
  data: { decidedByMembershipId: string; decisionReason: string | null; expiresAt?: Date | null },
  now: Date,
) {
  return withOrgContext(organizationId, async (tx) => {
    const res = await tx.approvalRequest.updateMany({
      where: { id, organizationId, status: "PENDING" },
      data: { status, decidedAt: now, decidedByMembershipId: data.decidedByMembershipId, decisionReason: data.decisionReason, expiresAt: data.expiresAt ?? null },
    });
    if (res.count !== 1) return null;
    return tx.approvalRequest.findFirstOrThrow({ where: { id, organizationId } });
  });
}

export function markResumed(organizationId: string, id: string, error: string | null, now: Date) {
  return withOrgContext(organizationId, (tx) =>
    tx.approvalRequest.updateMany({ where: { id, organizationId }, data: error === null ? { resumedAt: now, resumeError: null } : { resumeError: error.slice(0, 500) } }),
  );
}

/** The deal value and currency a grant must still match when it is used. */
export interface GrantSnapshot {
  value: number | null;
  currency: string;
}

/**
 * An approved, unspent, unexpired grant for moving this deal to this stage. When `snapshot` is given the grant must have been
 * asked for at the deal's current value and currency (an edit since then voids it); rows without a snapshot never match. When
 * `actor` is given, only the requester or someone who may edit every deal can spend it.
 */
export function findUsableMoveGrant(organizationId: string, dealId: string, toStageId: string, now: Date, snapshot?: GrantSnapshot, actor?: { membershipId: string; canEditAll: boolean }) {
  return withOrgContext(organizationId, async (tx) => {
    const rows = await tx.approvalRequest.findMany({
      where: {
        organizationId,
        kind: "LARGE_DEAL",
        subjectType: "DEAL_MOVE",
        dealId,
        subjectId: `${dealId}:${toStageId}`,
        status: "APPROVED",
        consumedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { decidedAt: "desc" },
    });
    return (
      rows.find((r) => {
        if (snapshot) {
          if (r.grantCurrency === null || r.grantCurrency !== snapshot.currency) return false;
          const granted = r.grantValue === null ? null : Number(r.grantValue);
          if (granted !== snapshot.value) return false;
        }
        if (actor && !actor.canEditAll && r.requestedByMembershipId !== actor.membershipId) return false;
        return true;
      }) ?? null
    );
  });
}

/** Withdraws an approved grant that has not been spent, so it can no longer be used. */
export function revokeGrant(organizationId: string, id: string, now: Date) {
  return withOrgContext(organizationId, async (tx) => {
    const res = await tx.approvalRequest.updateMany({ where: { id, organizationId, status: "APPROVED", consumedAt: null, subjectType: "DEAL_MOVE" }, data: { expiresAt: now } });
    return res.count === 1;
  });
}

/** Spends a grant once: two moves cannot use one approval. */
export function consumeGrant(organizationId: string, id: string, now: Date) {
  return withOrgContext(organizationId, async (tx) => {
    const res = await tx.approvalRequest.updateMany({ where: { id, organizationId, status: "APPROVED", consumedAt: null }, data: { consumedAt: now } });
    return res.count === 1;
  });
}
