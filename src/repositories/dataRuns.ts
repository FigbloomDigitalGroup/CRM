import type { DataRun, DataRunKind, DataRunStatus, Prisma } from "@prisma/client";
import { withOrgContext } from "../db/orgScopedClient";

/** Data access for `data_runs` (FIG-1034). Every call runs inside the organisation's RLS context. */

export const TERMINAL_STATUSES: DataRunStatus[] = ["COMPLETED", "COMPLETED_WITH_ERRORS", "FAILED", "CANCELLED"];

export function createDataRun(input: {
  organizationId: string;
  kind: DataRunKind;
  entity: string;
  createdByMembershipId: string;
  sourceFileId?: string;
  params: Prisma.InputJsonValue;
}) {
  return withOrgContext(input.organizationId, (tx) =>
    tx.dataRun.create({
      data: {
        organizationId: input.organizationId,
        kind: input.kind,
        entity: input.entity,
        createdByMembershipId: input.createdByMembershipId,
        sourceFileId: input.sourceFileId,
        params: input.params,
      },
    }),
  );
}

export function getDataRun(organizationId: string, id: string) {
  return withOrgContext(organizationId, (tx) => tx.dataRun.findFirst({ where: { id, organizationId } }));
}

export function updateDataRun(organizationId: string, id: string, data: Prisma.DataRunUncheckedUpdateManyInput) {
  return withOrgContext(organizationId, (tx) => tx.dataRun.updateMany({ where: { id, organizationId }, data }));
}

/** Flags the run so the job stops at its next check; a run that is already over is left alone. */
export function requestCancel(organizationId: string, id: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.dataRun.updateMany({
      where: { id, organizationId, status: { in: ["QUEUED", "RUNNING"] } },
      data: { cancelRequested: true },
    }),
  );
}

export async function isCancelRequested(organizationId: string, id: string): Promise<boolean> {
  const run = await getDataRun(organizationId, id);
  return run?.cancelRequested ?? false;
}

export function listDataRuns(organizationId: string, filter: { kind?: DataRunKind; createdByMembershipId?: string; take: number; skip: number }) {
  const where: Prisma.DataRunWhereInput = {
    organizationId,
    ...(filter.kind ? { kind: filter.kind } : {}),
    ...(filter.createdByMembershipId ? { createdByMembershipId: filter.createdByMembershipId } : {}),
  };
  return withOrgContext(organizationId, async (tx) => {
    const [rows, total] = await Promise.all([
      tx.dataRun.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: filter.take, skip: filter.skip }),
      tx.dataRun.count({ where }),
    ]);
    return { rows, total };
  });
}

export type { DataRun };
