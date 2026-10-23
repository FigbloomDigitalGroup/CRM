import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { NotFoundError, ValidationError } from "../auth/errors";
import { recordAuditEvent } from "../repositories/auditEvents";
import { getCompanyById } from "../repositories/companies";
import { getContactById } from "../repositories/contacts";
import { getMergeRecord, listMergeRecords, undoMergeRecords, type MergeEntity } from "../repositories/merges";

/**
 * Undoing a merge (FIG-1033, B2.04). A merge can be reversed for a short
 * period (`MERGE_UNDO_WINDOW_MS`) by someone who may merge that kind of record.
 * It puts the moved rows back on the loser, restores the surviving record's
 * merged fields where nobody has edited them since, and reactivates the loser.
 */
const PERMISSION: Record<MergeEntity, string> = {
  Company: "companies.merge",
  Contact: "contacts.merge",
};

const AUDIT_ENTITY = { Company: "company", Contact: "contact" } as const;

export async function undoMerge(ctx: AuthContext, mergeRecordId: string) {
  const record = await getMergeRecord(ctx.organizationId, mergeRecordId);
  if (!record) throw new NotFoundError("Merge", mergeRecordId);
  const entity = record.entityType as MergeEntity;
  requirePermission(ctx, PERMISSION[entity]);

  if (record.undoneAt) throw new ValidationError("This merge has already been undone.");
  if (record.undoExpiresAt.getTime() < Date.now()) {
    throw new ValidationError("The time to undo this merge has passed.");
  }

  const load = entity === "Company" ? getCompanyById : getContactById;
  const [loser, winner] = await Promise.all([
    load(ctx.organizationId, record.loserId),
    load(ctx.organizationId, record.winnerId),
  ]);
  if (!loser || loser.mergedIntoId !== record.winnerId) {
    throw new ValidationError("The merged record has changed since the merge; it cannot be undone.");
  }
  if (!winner || winner.archivedAt) {
    throw new ValidationError("The surviving record has been archived; restore it before undoing the merge.");
  }

  const result = await undoMergeRecords(ctx.organizationId, mergeRecordId, ctx.membershipId);

  const base = { organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, entityType: entity };
  await recordAuditEvent({
    ...base,
    action: `${AUDIT_ENTITY[entity]}.merge_undone`,
    entityId: record.loserId,
    metadata: { mergeRecordId, winnerId: record.winnerId, restoredFields: result.restoredFields },
  });
  await recordAuditEvent({
    ...base,
    action: `${AUDIT_ENTITY[entity]}.merge_undone_from`,
    entityId: record.winnerId,
    metadata: { mergeRecordId, loserId: record.loserId },
  });
  return result.loser;
}

/** Merges that involved this record, newest first, with whether each can still be undone. */
export async function listMergesFor(ctx: AuthContext, entity: MergeEntity, recordId: string) {
  requirePermission(ctx, PERMISSION[entity]);
  const records = await listMergeRecords(ctx.organizationId, entity, recordId);
  const now = Date.now();
  return records.map((r) => ({
    id: r.id,
    entityType: r.entityType,
    winnerId: r.winnerId,
    loserId: r.loserId,
    mergedAt: r.mergedAt,
    undoExpiresAt: r.undoExpiresAt,
    undoneAt: r.undoneAt,
    canUndo: !r.undoneAt && r.undoExpiresAt.getTime() >= now,
  }));
}
