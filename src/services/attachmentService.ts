import type { Attachment, File } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { hasPermission, requirePermission } from "../auth/context";
import { NotFoundError, ValidationError } from "../auth/errors";
import { canSeeDealValue } from "../auth/masking";
import { assertWritable } from "../lib/archive";
import { recordAuditEvent } from "../repositories/auditEvents";
import {
  createAttachmentRecord,
  getAttachmentById,
  listAttachmentsForRecord,
  parentColumn,
  softDeleteAttachment,
  type AttachmentParent,
} from "../repositories/attachments";
import { getCompany } from "./companyService";
import { getContact } from "./contactService";
import { getDeal } from "./dealService";
import { completeUpload, createUpload, issueDownloadLinkAuthorised, markFileDeleted } from "./fileService";
import { getLead } from "./leadService";
import { getTask } from "./taskService";

/**
 * Files attached to records (FIG-796). The bytes go through the file service
 * (B1.07: type and size limits, content sniffing, malware hook, signed links);
 * this service decides who may attach, see and remove them.
 *
 *   upload  : `attachments.manage`, and the record is open to the caller and not archived.
 *   see     : anyone who can open the record. Files on a deal are for people who
 *             may see deal values, unless the uploader shared them.
 *   remove  : the uploader, or Management (`configuration.manage`).
 *
 * Downloads are short-lived signed links issued after those checks; files are
 * never served from a public folder.
 */

const AUDIT_ENTITY = { lead: "Lead", contact: "Contact", company: "Company", deal: "Deal", task: "Task" } as const;

interface LoadedParent {
  archivable: Parameters<typeof assertWritable>[2];
  type: Parameters<typeof assertWritable>[1];
  /** Deals only: whether the caller may see this deal's value. */
  valueVisible: boolean;
}

/** Loads the record, which also proves the caller may open it (404 otherwise). */
async function loadParent(ctx: AuthContext, parent: AttachmentParent, id: string): Promise<LoadedParent> {
  switch (parent) {
    case "lead":
      return { archivable: await getLead(ctx, id), type: "lead", valueVisible: true };
    case "contact":
      return { archivable: await getContact(ctx, id), type: "contact", valueVisible: true };
    case "company":
      return { archivable: await getCompany(ctx, id), type: "company", valueVisible: true };
    case "task":
      return { archivable: await getTask(ctx, id), type: "task", valueVisible: true };
    case "deal": {
      const deal = await getDeal(ctx, id);
      return { archivable: deal, type: "deal", valueVisible: canSeeDealValue(ctx, deal) };
    }
  }
}

function parentIdOf(attachment: Attachment): { parent: AttachmentParent; id: string } {
  for (const parent of ["lead", "contact", "company", "deal", "task"] as const) {
    const id = attachment[parentColumn(parent)];
    if (id) return { parent, id };
  }
  throw new Error(`Attachment ${attachment.id} has no record.`);
}

function visibleTo(ctx: AuthContext, attachment: Attachment, parent: LoadedParent): boolean {
  if (attachment.uploadedByMembershipId === ctx.membershipId) return true;
  if (attachment.dealId && !parent.valueVisible && !attachment.shared) return false;
  return true;
}

export interface AddAttachmentInput {
  name: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256?: string;
  title?: string;
  /** Deals only: share with people who may not see the deal value. Default: not shared. */
  shared?: boolean;
  proposalReferenceId?: string;
}

/** Records the attachment and returns the signed upload link; the client sends the bytes, then calls `completeAttachment`. */
export async function addAttachment(ctx: AuthContext, parent: AttachmentParent, parentId: string, input: AddAttachmentInput) {
  const loaded = await loadParent(ctx, parent, parentId);
  requirePermission(ctx, "attachments.manage");
  assertWritable(ctx, loaded.type, loaded.archivable, "attaching files");
  if (input.proposalReferenceId && parent !== "deal") {
    throw new ValidationError("A proposal can only be named on a file attached to a deal.", [{ path: "proposalReferenceId", message: "Only for deals." }]);
  }
  if (parent === "deal" && input.shared && !loaded.valueVisible) {
    // Someone who cannot see the value cannot judge whether the document shows it.
    throw new ValidationError("Only someone who can see this deal's value can share its files.", [{ path: "shared", message: "Not allowed." }]);
  }
  const title = input.title?.trim().slice(0, 120) || null;

  const { file, upload } = await createUpload(ctx, {
    purpose: "ATTACHMENT",
    name: input.name,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    checksumSha256: input.checksumSha256,
  });
  const attachment = await createAttachmentRecord({
    organizationId: ctx.organizationId,
    fileId: file.id,
    parent,
    parentId,
    proposalReferenceId: input.proposalReferenceId ?? null,
    title,
    shared: parent === "deal" ? (input.shared ?? false) : true,
    uploadedByMembershipId: ctx.membershipId,
  });
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "attachment.added",
    entityType: AUDIT_ENTITY[parent],
    entityId: parentId,
    metadata: { attachmentId: attachment.id, fileName: file.name, sizeBytes: file.sizeBytes },
  });
  return { attachment, upload };
}

/** After the bytes are uploaded: scan and verify them, then the file becomes available. */
export async function completeAttachment(ctx: AuthContext, attachmentId: string) {
  const attachment = await getAttachmentById(ctx.organizationId, attachmentId);
  if (!attachment || attachment.uploadedByMembershipId !== ctx.membershipId) throw new NotFoundError("Attachment", attachmentId);
  const file = await completeUpload(ctx, attachment.fileId);
  return { ...attachment, file };
}

export async function listAttachments(ctx: AuthContext, parent: AttachmentParent, parentId: string) {
  const loaded = await loadParent(ctx, parent, parentId);
  const all = await listAttachmentsForRecord(ctx.organizationId, parent, parentId);
  return all
    .filter((a) => visibleTo(ctx, a, loaded))
    // Another person's upload that has not finished is not a file yet.
    .filter((a) => a.file.status === "READY" || a.uploadedByMembershipId === ctx.membershipId)
    .map((a) => ({ ...a, file: a.file as File }));
}

async function loadForRecordAccess(ctx: AuthContext, attachmentId: string) {
  const attachment = await getAttachmentById(ctx.organizationId, attachmentId);
  if (!attachment) throw new NotFoundError("Attachment", attachmentId);
  const { parent, id } = parentIdOf(attachment);
  const loaded = await loadParent(ctx, parent, id);
  if (!visibleTo(ctx, attachment, loaded)) throw new NotFoundError("Attachment", attachmentId);
  return { attachment, parent, parentId: id, loaded };
}

/** Proves the caller may open the record an attachment hangs off (404 otherwise); used by the file routes too. */
export async function assertAttachmentRecordAccess(ctx: AuthContext, attachmentId: string): Promise<void> {
  await loadForRecordAccess(ctx, attachmentId);
}

/** A short-lived signed link, issued after the record access check on this call, and audited. */
export async function getAttachmentDownload(ctx: AuthContext, attachmentId: string) {
  const { attachment, parent, parentId } = await loadForRecordAccess(ctx, attachmentId);
  const result = await issueDownloadLinkAuthorised(attachment.file);
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "attachment.downloaded",
    entityType: AUDIT_ENTITY[parent],
    entityId: parentId,
    metadata: { attachmentId, fileName: attachment.file.name },
  });
  return { attachment, ...result };
}

export async function deleteAttachment(ctx: AuthContext, attachmentId: string) {
  const { attachment, parent, parentId, loaded } = await loadForRecordAccess(ctx, attachmentId);
  const mine = attachment.uploadedByMembershipId === ctx.membershipId;
  if (!mine && !hasPermission(ctx, "configuration.manage")) throw new NotFoundError("Attachment", attachmentId);
  assertWritable(ctx, loaded.type, loaded.archivable, "removing files");
  await softDeleteAttachment(ctx.organizationId, attachmentId);
  await markFileDeleted(ctx, attachment.file);
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "attachment.deleted",
    entityType: AUDIT_ENTITY[parent],
    entityId: parentId,
    metadata: { attachmentId, fileName: attachment.file.name },
  });
  return { id: attachmentId };
}
