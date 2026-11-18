import type { AuthContext } from "../auth/context";
import { canActOnOwnedRecord, hasPermission } from "../auth/context";
import { ArchivedReadOnlyError, ValidationError } from "../auth/errors";

/**
 * Archive semantics shared by every archivable record (FIG-1045, B2.16).
 *
 * Archiving is a soft delete: `archivedAt`, `archivedByMembershipId` and
 * `archiveReason` are set together and cleared together on restore. While a
 * record is archived it is read-only; any write is refused with the code
 * `ARCHIVED_READ_ONLY` and a restore hint, from this one place, so no service
 * has to remember the rule or word the message its own way.
 */
export type ArchivableType = "lead" | "deal" | "company" | "contact" | "task";

const LABEL: Record<ArchivableType, string> = {
  lead: "lead",
  deal: "deal",
  company: "company",
  contact: "contact",
  task: "task",
};

export const MAX_ARCHIVE_REASON_LENGTH = 500;

/** Who archived a record and why; stored with `archivedAt`. */
export interface ArchiveMeta {
  membershipId?: string | null;
  reason?: string | null;
}

/** The fields every archivable record carries. */
export interface ArchivableRecord {
  id: string;
  archivedAt: Date | null;
  archivedByMembershipId?: string | null;
  archiveReason?: string | null;
  /** Leads and deals. */
  ownerMembershipId?: string | null;
  /** Tasks. */
  assigneeMembershipId?: string | null;
  createdByMembershipId?: string | null;
}

/** Whether this caller may restore the record: the same rule as archiving it. */
export function canRestoreRecord(ctx: AuthContext, type: ArchivableType, record: ArchivableRecord): boolean {
  switch (type) {
    case "lead":
      return canActOnOwnedRecord(ctx, "leads.archive.own", "leads.archive.all", record.ownerMembershipId ?? null);
    case "deal":
      return canActOnOwnedRecord(ctx, "deals.archive.own", "deals.archive.all", record.ownerMembershipId ?? null);
    case "company":
      return hasPermission(ctx, "companies.archive");
    case "contact":
      return hasPermission(ctx, "contacts.archive");
    case "task":
      return (
        hasPermission(ctx, "tasks.assign.any") ||
        record.assigneeMembershipId === ctx.membershipId ||
        record.createdByMembershipId === ctx.membershipId
      );
  }
}

/** The error to throw for a write to an archived record. */
export function archivedWriteError(
  ctx: AuthContext,
  type: ArchivableType,
  record: ArchivableRecord,
  doing = "making changes",
): ArchivedReadOnlyError {
  const canRestore = canRestoreRecord(ctx, type, record);
  const hint = canRestore ? "Restore it before" : "Ask someone who can restore it before";
  return new ArchivedReadOnlyError(`This ${LABEL[type]} is archived. ${hint} ${doing}.`, {
    entityType: type,
    entityId: record.id,
    canRestore,
  });
}

/** Throws `ARCHIVED_READ_ONLY` when the record is archived. */
export function assertWritable(
  ctx: AuthContext,
  type: ArchivableType,
  record: ArchivableRecord,
  doing?: string,
): void {
  if (record.archivedAt) throw archivedWriteError(ctx, type, record, doing);
}

/** What the archived banner shows: when, by whom, why, and whether the caller can restore it. Null when the record is active. */
export function archiveBanner(ctx: AuthContext, type: ArchivableType, record: ArchivableRecord) {
  if (!record.archivedAt) return null;
  return {
    archivedAt: record.archivedAt,
    archivedByMembershipId: record.archivedByMembershipId ?? null,
    reason: record.archiveReason ?? null,
    canRestore: canRestoreRecord(ctx, type, record),
  };
}

/** Trims an optional archive reason; empty means none. */
export function cleanArchiveReason(reason: string | null | undefined): string | null {
  if (reason === undefined || reason === null) return null;
  const trimmed = reason.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_ARCHIVE_REASON_LENGTH) {
    throw new ValidationError(`The reason can be at most ${MAX_ARCHIVE_REASON_LENGTH} characters.`, [
      { path: "reason", message: `At most ${MAX_ARCHIVE_REASON_LENGTH} characters.` },
    ]);
  }
  return trimmed;
}

/** `archived` list filter: hide archived (default), include them, or show only them (the archived tab). */
export type ArchivedFilter = "exclude" | "include" | "only";

export function archivedWhere(filter: { includeArchived?: boolean; archivedOnly?: boolean }): { archivedAt?: null | { not: null } } {
  if (filter.archivedOnly) return { archivedAt: { not: null } };
  if (filter.includeArchived) return {};
  return { archivedAt: null };
}
