import type { Prisma } from "@prisma/client";
import { withOrgContext } from "../db/orgScopedClient";

/** Data access for `attachments` (FIG-796). Every call runs inside the organisation's RLS context. */

export type AttachmentParent = "lead" | "contact" | "company" | "deal" | "task";

const COLUMN: Record<AttachmentParent, "leadId" | "contactId" | "companyId" | "dealId" | "taskId"> = {
  lead: "leadId",
  contact: "contactId",
  company: "companyId",
  deal: "dealId",
  task: "taskId",
};

export function parentColumn(parent: AttachmentParent) {
  return COLUMN[parent];
}

const WITH_FILE = { file: true } satisfies Prisma.AttachmentInclude;

export function createAttachmentRecord(input: {
  organizationId: string;
  fileId: string;
  parent: AttachmentParent;
  parentId: string;
  proposalReferenceId?: string | null;
  title?: string | null;
  shared: boolean;
  uploadedByMembershipId: string;
}) {
  return withOrgContext(input.organizationId, (tx) =>
    tx.attachment.create({
      data: {
        organizationId: input.organizationId,
        fileId: input.fileId,
        [COLUMN[input.parent]]: input.parentId,
        proposalReferenceId: input.proposalReferenceId ?? null,
        title: input.title ?? null,
        shared: input.shared,
        uploadedByMembershipId: input.uploadedByMembershipId,
      },
      include: WITH_FILE,
    }),
  );
}

export function getAttachmentById(organizationId: string, id: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.attachment.findFirst({ where: { id, organizationId, deletedAt: null }, include: WITH_FILE }),
  );
}

/** Attachments of one record, newest first. Files still uploading are included so the uploader can see progress. */
export function listAttachmentsForRecord(organizationId: string, parent: AttachmentParent, parentId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.attachment.findMany({
      where: { organizationId, deletedAt: null, [COLUMN[parent]]: parentId, file: { status: { in: ["UPLOADING", "READY", "QUARANTINED"] } } },
      include: WITH_FILE,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    }),
  );
}

export function softDeleteAttachment(organizationId: string, id: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.attachment.update({ where: { id, organizationId }, data: { deletedAt: new Date() } }),
  );
}

/** Every file attached to a contact or to its tasks, for erasure. */
export function listFileIdsForContactErasure(organizationId: string, contactId: string) {
  return withOrgContext(organizationId, async (tx) => {
    const rows = await tx.attachment.findMany({
      where: { organizationId, OR: [{ contactId }, { task: { contactId } }] },
      select: { fileId: true },
    });
    return rows.map((r) => r.fileId);
  });
}
