import { createHash, randomUUID } from "node:crypto";
import type { File, FilePurpose } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { deny, hasPermission } from "../auth/context";
import { NotFoundError, ValidationError } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import { ApiError } from "../lib/apiErrors";
import { recordAuditEvent } from "../repositories/auditEvents";
import {
  createFileRecord,
  getFileById,
  updateFileRecord,
} from "../repositories/files";
import {
  FILE_POLICIES,
  INLINE_PURPOSES,
  checkFileName,
  extensionOf,
  findAllowedType,
  type FilePolicy,
} from "../storage/policy";
import { buildStorageKey } from "../storage/keys";
import { getStorageDriver } from "../storage";
import { getScanHook } from "../storage/scan";
import { contentMatchesMime } from "../storage/sniff";
import { StorageObjectTooLargeError } from "../storage/types";

/**
 * The one door to stored files (FIG-1023, B1.07). Avatars, organisation logos,
 * attachments, imports and exports all go through here, so the limits, the
 * content checks, the malware hook and the "who may download" rule exist once.
 *
 * Flow: `createUpload` records the file as UPLOADING and returns a short-lived
 * signed upload link; the client sends the bytes straight to storage;
 * `completeUpload` reads them back, checks size, type, content and checksum,
 * runs the scan hook, and only then makes the file READY. A QUARANTINED or
 * DELETED file is never served, by link or by the authenticated route.
 */

/** One issue reads best as the message itself, the way the shared request validation does it. */
function refused(issues: { path: string; message: string; code?: string }[]): ValidationError {
  return new ValidationError(issues.length === 1 ? issues[0]!.message : "The file was refused.", issues);
}

/** A download link lives this long; it is issued after an authorisation check, so it stays short. */
export const DOWNLOAD_LINK_SECONDS = 60;

/** Soft-deleted files keep their bytes this long before the purge removes them (retention rules arrive with B4.05). */
export const DEFAULT_RETENTION_DAYS = 30;

// ---------------------------------------------------------------------------
// Who may do what, per purpose
// ---------------------------------------------------------------------------

interface PurposeRule {
  /** Permission keys, any one of which lets a member create files of this purpose; empty = any member. */
  create: readonly string[];
  /** Created through the client API at all? Exports are produced by the system. */
  clientCreatable: boolean;
  /** Permission keys that let someone other than the owner download and delete. Empty = anyone in the organisation may download. */
  manage: readonly string[];
  /** Everyone in the organisation may read it (an avatar or a logo is shown to colleagues). */
  readableByAll: boolean;
}

const RULES: Record<FilePurpose, PurposeRule> = {
  AVATAR: { create: [], clientCreatable: true, manage: [], readableByAll: true },
  LOGO: {
    create: ["organization.manage_settings"],
    clientCreatable: true,
    manage: ["organization.manage_settings"],
    readableByAll: true,
  },
  ATTACHMENT: {
    create: ["attachments.manage"],
    clientCreatable: true,
    manage: ["attachments.manage"],
    readableByAll: false,
  },
  IMPORT: {
    create: ["leads.import", "contacts.import", "companies.import"],
    clientCreatable: true,
    manage: ["configuration.manage"],
    readableByAll: false,
  },
  EXPORT: { create: [], clientCreatable: false, manage: ["configuration.manage"], readableByAll: false },
};

function requireCreate(ctx: AuthContext, purpose: FilePurpose) {
  const rule = RULES[purpose];
  if (!rule.clientCreatable) {
    throw new ValidationError(`Files for ${purpose.toLowerCase()} are created by the system, not uploaded.`);
  }
  if (rule.create.length > 0 && !rule.create.some((k) => hasPermission(ctx, k))) {
    throw deny(ctx, rule.create.join(" or "), [...rule.create]);
  }
}

/** The caller owns the file, or holds a permission that manages files of its purpose. */
function canManage(ctx: AuthContext, file: Pick<File, "purpose" | "ownerMembershipId">): boolean {
  if (file.ownerMembershipId === ctx.membershipId) return true;
  return RULES[file.purpose].manage.some((k) => hasPermission(ctx, k));
}

function canRead(ctx: AuthContext, file: Pick<File, "purpose" | "ownerMembershipId">): boolean {
  return RULES[file.purpose].readableByAll || canManage(ctx, file);
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreateUploadInput {
  purpose: FilePurpose;
  name: string;
  mimeType: string;
  sizeBytes: number;
  /** Hex SHA-256 of the bytes; when given, `completeUpload` refuses a file that does not match. */
  checksumSha256?: string;
}

function validateDeclared(policy: FilePolicy, input: { name: string; mimeType: string; sizeBytes: number; checksumSha256?: string }) {
  const issues: { path: string; message: string; code?: string }[] = [];
  const nameCheck = checkFileName(input.name);
  if (!nameCheck.ok) issues.push({ path: "name", message: nameCheck.reason!, code: "FILE_NAME_INVALID" });

  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 0) {
    issues.push({ path: "sizeBytes", message: "The size must be a whole number of bytes.", code: "FILE_SIZE_INVALID" });
  } else if (input.sizeBytes > policy.maxBytes) {
    issues.push({
      path: "sizeBytes",
      message: `The file is larger than the ${Math.round(policy.maxBytes / (1024 * 1024))} MB limit for this kind of file.`,
      code: "FILE_TOO_LARGE",
    });
  }
  if (input.sizeBytes === 0) issues.push({ path: "sizeBytes", message: "The file is empty.", code: "FILE_EMPTY" });

  const extension = extensionOf(nameCheck.name);
  if (!findAllowedType(policy, input.mimeType, extension)) {
    issues.push({
      path: "mimeType",
      message: `A ${extension ? `.${extension}` : "file without an extension"} declared as ${input.mimeType} is not allowed for this kind of file.`,
      code: "FILE_TYPE_NOT_ALLOWED",
    });
  }
  if (input.checksumSha256 !== undefined && !/^[0-9a-f]{64}$/i.test(input.checksumSha256)) {
    issues.push({ path: "checksumSha256", message: "The checksum must be a 64-character hex SHA-256.", code: "FILE_CHECKSUM_INVALID" });
  }
  if (issues.length > 0) throw refused(issues);
  return nameCheck.name;
}

export async function createUpload(ctx: AuthContext, input: CreateUploadInput) {
  requireCreate(ctx, input.purpose);
  const policy = FILE_POLICIES[input.purpose];
  const name = validateDeclared(policy, input);

  const id = randomUUID();
  const storageKey = buildStorageKey(ctx.organizationId, input.purpose.toLowerCase(), id);
  const expiresAt = new Date(Date.now() + policy.uploadLinkSeconds * 1000);

  const file = await createFileRecord({
    id,
    organizationId: ctx.organizationId,
    ownerMembershipId: ctx.membershipId,
    purpose: input.purpose,
    name,
    sizeBytes: input.sizeBytes,
    mimeType: input.mimeType.toLowerCase(),
    checksumSha256: input.checksumSha256?.toLowerCase() ?? null,
    storageKey,
    status: "UPLOADING",
    uploadExpiresAt: expiresAt,
  });

  const upload = await getStorageDriver().signUpload(storageKey, {
    contentType: file.mimeType,
    expiresInSeconds: policy.uploadLinkSeconds,
    maxBytes: policy.maxBytes,
  });
  return { file, upload };
}

// ---------------------------------------------------------------------------
// Complete: size, type, content, checksum, scan
// ---------------------------------------------------------------------------

async function rejectUpload(file: File, reason: string, issuePath: string, code: string): Promise<never> {
  await getStorageDriver().deleteObject(file.storageKey).catch(() => undefined);
  await updateFileRecord(file.organizationId, file.id, {
    status: "DELETED",
    deletedAt: new Date(),
    purgedAt: new Date(),
    quarantineReason: reason,
  });
  throw refused([{ path: issuePath, message: reason, code }]);
}

export async function completeUpload(ctx: AuthContext, fileId: string) {
  const file = await loadVisible(ctx, fileId);
  if (file.ownerMembershipId !== ctx.membershipId) throw new NotFoundError("File", fileId);

  if (file.status === "READY") return file; // completing twice is harmless
  if (file.status === "QUARANTINED") throw quarantined();
  if (file.status !== "UPLOADING") throw new NotFoundError("File", fileId);

  const policy = FILE_POLICIES[file.purpose];
  const driver = getStorageDriver();

  const head = await driver.headObject(file.storageKey);
  if (!head) {
    throw new ValidationError("No upload was received for this file yet.", [
      { path: "file", message: "Upload the file to the link first." },
    ]);
  }
  if (head.size > policy.maxBytes) {
    return rejectUpload(file, "The uploaded file is larger than the limit for this kind of file.", "sizeBytes", "FILE_TOO_LARGE");
  }
  if (head.size === 0) return rejectUpload(file, "The uploaded file is empty.", "sizeBytes", "FILE_EMPTY");

  let data: Buffer;
  try {
    data = await driver.getObject(file.storageKey, policy.maxBytes);
  } catch (err) {
    if (err instanceof StorageObjectTooLargeError) {
      return rejectUpload(file, "The uploaded file is larger than the limit for this kind of file.", "sizeBytes", "FILE_TOO_LARGE");
    }
    throw err;
  }

  if (!contentMatchesMime(data, file.mimeType)) {
    return rejectUpload(file, "The content of the file does not match its declared type.", "mimeType", "FILE_CONTENT_MISMATCH");
  }

  const checksum = createHash("sha256").update(data).digest("hex");
  if (file.checksumSha256 && file.checksumSha256 !== checksum) {
    return rejectUpload(file, "The file does not match the checksum that was declared.", "checksumSha256", "FILE_CHECKSUM_MISMATCH");
  }

  const verdict = await getScanHook().scan(data, { fileName: file.name, mimeType: file.mimeType });
  if (verdict.status === "error") {
    // Fail closed: an unscanned file is never made available. It stays UPLOADING; the client retries.
    throw new ApiError(503, "SERVICE_UNAVAILABLE", "The file could not be scanned right now. Try again in a moment.");
  }

  if (verdict.status === "infected") {
    const quarantinedFile = await updateFileRecord(ctx.organizationId, file.id, {
      status: "QUARANTINED",
      sizeBytes: data.length,
      checksumSha256: checksum,
      scanResult: `infected:${verdict.signature}`,
      quarantineReason: "Malware was detected in the file.",
    });
    await recordAuditEvent({
      organizationId: ctx.organizationId,
      actorMembershipId: ctx.membershipId,
      action: "file.quarantined",
      entityType: "File",
      entityId: file.id,
      metadata: { purpose: file.purpose, signature: verdict.signature },
    });
    void quarantinedFile;
    throw quarantined();
  }

  const ready = await updateFileRecord(ctx.organizationId, file.id, {
    status: "READY",
    sizeBytes: data.length,
    checksumSha256: checksum,
    scanResult: "clean",
    readyAt: new Date(),
    uploadExpiresAt: null,
  });
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "file.uploaded",
    entityType: "File",
    entityId: file.id,
    metadata: { purpose: file.purpose, sizeBytes: data.length },
  });
  return ready;
}

function quarantined() {
  return new ApiError(409, "FILE_UNAVAILABLE", "This file was quarantined by the malware scan and cannot be used.");
}

// ---------------------------------------------------------------------------
// Read, download, delete
// ---------------------------------------------------------------------------

/** The file if it exists in the caller's organisation, is not deleted and the caller may see it; otherwise 404 (no existence leak). */
async function loadVisible(ctx: AuthContext, fileId: string): Promise<File> {
  const file = await getFileById(ctx.organizationId, fileId);
  if (!file || file.status === "DELETED" || !canRead(ctx, file)) throw new NotFoundError("File", fileId);
  await assertAttachmentFileAccess(ctx, file);
  return file;
}

/**
 * A file attached to a record is as private as the record. Holding `attachments.manage` is not enough to open another person's
 * attachment by its file id: the caller must also be able to open the lead, deal, contact, company or task it hangs off (the same
 * check the attachment routes make). A file not yet attached to anything has no record to check and stays as it was.
 */
async function assertAttachmentFileAccess(ctx: AuthContext, file: File): Promise<void> {
  if (file.purpose !== "ATTACHMENT" || file.ownerMembershipId === ctx.membershipId) return;
  const linked = await adminDb.attachment.findFirst({ where: { fileId: file.id, organizationId: ctx.organizationId, deletedAt: null }, select: { id: true } });
  if (!linked) return; // not attached to a record yet: nothing further to check
  // Loaded on use: the attachment service imports this one.
  const { assertAttachmentRecordAccess } = await import("./attachmentService");
  await assertAttachmentRecordAccess(ctx, linked.id);
}

export async function getFile(ctx: AuthContext, fileId: string) {
  return loadVisible(ctx, fileId);
}

function assertServable(file: File) {
  if (file.status === "QUARANTINED") throw quarantined();
  if (file.status !== "READY") throw new NotFoundError("File", file.id);
}

/** A short-lived signed download link, issued only after the authorisation check on this call. */
export async function getDownloadLink(ctx: AuthContext, fileId: string) {
  const file = await loadVisible(ctx, fileId);
  assertServable(file);
  const link = await getStorageDriver().signDownload(file.storageKey, {
    expiresInSeconds: DOWNLOAD_LINK_SECONDS,
    fileName: file.name,
    contentType: file.mimeType,
    disposition: INLINE_PURPOSES.includes(file.purpose) ? "inline" : "attachment",
  });
  return { file, download: { url: link.url, expiresAt: link.expiresAt } };
}

/**
 * A download link for a file the caller has already been authorised to read by
 * some other rule (an attachment is readable by whoever can open its record).
 * The link is as short-lived as any other.
 */
export async function issueDownloadLinkAuthorised(file: File) {
  assertServable(file);
  const link = await getStorageDriver().signDownload(file.storageKey, {
    expiresInSeconds: DOWNLOAD_LINK_SECONDS,
    fileName: file.name,
    contentType: file.mimeType,
    disposition: "attachment",
  });
  return { file, download: { url: link.url, expiresAt: link.expiresAt } };
}

/** The bytes themselves, for the authenticated content route. */
export async function readFileContent(ctx: AuthContext, fileId: string) {
  const file = await loadVisible(ctx, fileId);
  assertServable(file);
  const data = await getStorageDriver().getObject(file.storageKey, FILE_POLICIES[file.purpose].maxBytes);
  return { file, data };
}

export async function deleteFile(ctx: AuthContext, fileId: string) {
  const file = await loadVisible(ctx, fileId);
  if (!canManage(ctx, file)) throw new NotFoundError("File", fileId);
  return markFileDeleted(ctx, file);
}

/** Soft-deletes a file the caller has already been authorised to remove (kept until the retention purge removes its bytes). */
export async function markFileDeleted(ctx: AuthContext, file: Pick<File, "id" | "purpose" | "status">) {
  const deleted = await updateFileRecord(ctx.organizationId, file.id, {
    status: "DELETED",
    deletedAt: new Date(),
  });
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "file.deleted",
    entityType: "File",
    entityId: file.id,
    previousValue: { status: file.status },
    metadata: { purpose: file.purpose },
  });
  return deleted;
}

// ---------------------------------------------------------------------------
// System side: generated files and the retention purge
// ---------------------------------------------------------------------------

export interface StoreGeneratedFileInput {
  organizationId: string;
  ownerMembershipId: string | null;
  purpose: FilePurpose;
  name: string;
  mimeType: string;
  data: Buffer;
}

/** For exports and other files the system produces: same checks and scan as an upload, no signed link. */
export async function storeGeneratedFile(input: StoreGeneratedFileInput) {
  const policy = FILE_POLICIES[input.purpose];
  const name = validateDeclared(policy, { name: input.name, mimeType: input.mimeType, sizeBytes: input.data.length });
  if (!contentMatchesMime(input.data, input.mimeType)) {
    throw refused([{ path: "mimeType", message: "The content of the file does not match its declared type.", code: "FILE_CONTENT_MISMATCH" }]);
  }
  const verdict = await getScanHook().scan(input.data, { fileName: name, mimeType: input.mimeType });
  if (verdict.status !== "clean") {
    throw new ApiError(
      verdict.status === "infected" ? 409 : 503,
      verdict.status === "infected" ? "FILE_UNAVAILABLE" : "SERVICE_UNAVAILABLE",
      verdict.status === "infected" ? "The generated file failed the malware scan." : "The file could not be scanned right now.",
    );
  }
  const id = randomUUID();
  const storageKey = buildStorageKey(input.organizationId, input.purpose.toLowerCase(), id);
  await getStorageDriver().putObject(storageKey, input.data, { contentType: input.mimeType });
  return createFileRecord({
    id,
    organizationId: input.organizationId,
    ownerMembershipId: input.ownerMembershipId,
    purpose: input.purpose,
    name,
    sizeBytes: input.data.length,
    mimeType: input.mimeType.toLowerCase(),
    checksumSha256: createHash("sha256").update(input.data).digest("hex"),
    storageKey,
    status: "READY",
  });
}

export interface PurgeOptions {
  /** Days a deleted file's bytes are kept; defaults to `DEFAULT_RETENTION_DAYS`. Retention rules (B4.05) will supply this per organisation. */
  retentionDays?: number;
  now?: Date;
}

/**
 * Removes the bytes of files deleted longer ago than the retention window, and
 * deletes the records of uploads that never completed. The row stays (status
 * DELETED, `purged_at` set) as the record that the file existed. Platform job
 * (the framework arrives with B2.18); safe to run repeatedly.
 */
export async function purgeDeletedFiles(options: PurgeOptions = {}) {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - (options.retentionDays ?? DEFAULT_RETENTION_DAYS) * 86_400_000);
  const driver = getStorageDriver();

  // Uploads that were never completed become deleted files after a day.
  await adminDb.file.updateMany({
    where: { status: "UPLOADING", uploadExpiresAt: { lt: new Date(now.getTime() - 86_400_000) } },
    data: { status: "DELETED", deletedAt: now },
  });

  const due = await adminDb.file.findMany({
    where: { status: "DELETED", purgedAt: null, deletedAt: { lte: cutoff } },
    select: { id: true, storageKey: true },
    take: 500,
  });
  for (const file of due) {
    await driver.deleteObject(file.storageKey);
    await adminDb.file.update({ where: { id: file.id }, data: { purgedAt: now } });
  }
  return { purged: due.length };
}
