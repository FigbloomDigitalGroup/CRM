import { DEFAULT_RETENTION_DAYS, purgeDeletedFiles } from "../../services/fileService";

/**
 * The file purge for one organisation: removes the bytes of deleted files, and of quarantined (infected) files, once
 * they are older than the retention window (`DEFAULT_RETENTION_DAYS`, 30 days). The database row stays with
 * `purged_at` set. Safe to repeat: a second run finds nothing left to purge.
 */
export const FILES_PURGE_JOB_TYPE = "files.purge";

export async function purgeOrganizationFiles(organizationId: string, now?: Date): Promise<{ purged: number; retentionDays: number }> {
  const { purged } = await purgeDeletedFiles({ organizationId, now, retentionDays: DEFAULT_RETENTION_DAYS });
  return { purged, retentionDays: DEFAULT_RETENTION_DAYS };
}
