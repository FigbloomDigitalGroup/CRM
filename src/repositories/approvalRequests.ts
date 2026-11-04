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

export function listApprovalRequests(organizationId: string, where: Prisma.ApprovalRequestWhereInput) {
  return withOrgContext(organizationId, (tx) => tx.approvalRequest.findMany({ where: { organizationId, ...where }, orderBy: [{ createdAt: "desc" }, { id: "asc" }] }));
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

/** An approved, unspent, unexpired grant for moving this deal to this stage. */
export function findUsableMoveGrant(organizationId: string, dealId: string, toStageId: string, now: Date) {
  return withOrgContext(organizationId, (tx) =>
    tx.approvalRequest.findFirst({
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
    }),
  );
}

/** Spends a grant once: two moves cannot use one approval. */
export function consumeGrant(organizationId: string, id: string, now: Date) {
  return withOrgContext(organizationId, async (tx) => {
    const res = await tx.approvalRequest.updateMany({ where: { id, organizationId, status: "APPROVED", consumedAt: null }, data: { consumedAt: now } });
    return res.count === 1;
  });
}
