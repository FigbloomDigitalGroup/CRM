import type { FilePurpose, FileStatus, Prisma } from "@prisma/client";
import { withOrgContext } from "../db/orgScopedClient";

/** Data access for `files` (FIG-1023, B1.07). Every call runs inside the organisation's RLS context. */
export interface CreateFileRecord {
  id: string;
  organizationId: string;
  ownerMembershipId: string | null;
  purpose: FilePurpose;
  name: string;
  sizeBytes: number;
  mimeType: string;
  checksumSha256?: string | null;
  storageKey: string;
  status?: FileStatus;
  uploadExpiresAt?: Date | null;
}

export function createFileRecord(input: CreateFileRecord) {
  return withOrgContext(input.organizationId, (tx) => tx.file.create({ data: input }));
}

export function getFileById(organizationId: string, fileId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.file.findFirst({ where: { id: fileId, organizationId } }),
  );
}

export function getFileByStorageKey(organizationId: string, storageKey: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.file.findFirst({ where: { storageKey, organizationId } }),
  );
}

export function updateFileRecord(organizationId: string, fileId: string, data: Prisma.FileUncheckedUpdateInput) {
  return withOrgContext(organizationId, (tx) =>
    tx.file.update({ where: { id: fileId, organizationId }, data }),
  );
}
