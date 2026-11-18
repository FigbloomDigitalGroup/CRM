import { z } from "zod";
import type { File } from "@prisma/client";
import { isoDateTime } from "./common";

export const FilePurposeSchema = z.enum(["AVATAR", "LOGO", "ATTACHMENT", "IMPORT", "EXPORT"]);
export const FileStatusSchema = z.enum(["UPLOADING", "READY", "QUARANTINED", "DELETED"]);

/** A file's metadata. The storage key is never exposed. */
export const FileSchema = z.strictObject({
  id: z.string(),
  purpose: FilePurposeSchema,
  name: z.string(),
  sizeBytes: z.number().int(),
  mimeType: z.string(),
  status: FileStatusSchema,
  checksumSha256: z.string().nullable(),
  ownerMembershipId: z.string().nullable(),
  createdAt: isoDateTime,
  readyAt: isoDateTime.nullable(),
});

export function toFileDto(file: File) {
  return {
    id: file.id,
    purpose: file.purpose,
    name: file.name,
    sizeBytes: file.sizeBytes,
    mimeType: file.mimeType,
    status: file.status,
    checksumSha256: file.checksumSha256,
    ownerMembershipId: file.ownerMembershipId,
    createdAt: file.createdAt,
    readyAt: file.readyAt,
  };
}

export const CreateUploadBodySchema = z.strictObject({
  purpose: FilePurposeSchema,
  name: z.string({ error: "A file name is required." }),
  mimeType: z.string({ error: "A file type is required." }),
  sizeBytes: z.number({ error: "The file size is required." }).int(),
  checksumSha256: z.string().optional(),
});

export const CreateUploadResponseSchema = z.strictObject({
  file: FileSchema,
  upload: z.strictObject({
    url: z.string(),
    method: z.literal("PUT"),
    /** Send exactly these headers with the upload. */
    headers: z.record(z.string(), z.string()),
    expiresAt: isoDateTime,
  }),
});

export const DownloadLinkResponseSchema = z.strictObject({
  file: FileSchema,
  download: z.strictObject({ url: z.string(), expiresAt: isoDateTime }),
});
