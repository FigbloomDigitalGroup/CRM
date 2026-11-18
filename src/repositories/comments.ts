import type { Prisma } from "@prisma/client";
import { withOrgContext } from "../db/orgScopedClient";

/** Data access for `comments`, `comment_mentions` and `record_follows` (FIG-1044). Every call runs inside the organisation's RLS context. */

export type CommentParent = "lead" | "contact" | "company" | "deal" | "task";

const COLUMN: Record<CommentParent, "leadId" | "contactId" | "companyId" | "dealId" | "taskId"> = {
  lead: "leadId",
  contact: "contactId",
  company: "companyId",
  deal: "dealId",
  task: "taskId",
};

export function parentColumn(parent: CommentParent) {
  return COLUMN[parent];
}

const WITH_AUTHOR = {
  mentions: { select: { membershipId: true } },
} satisfies Prisma.CommentInclude;

export function createCommentRecord(input: {
  organizationId: string;
  parent: CommentParent;
  parentId: string;
  authorMembershipId: string;
  body: string;
  mentionIds: string[];
}) {
  return withOrgContext(input.organizationId, (tx) =>
    tx.comment.create({
      data: {
        organizationId: input.organizationId,
        [COLUMN[input.parent]]: input.parentId,
        authorMembershipId: input.authorMembershipId,
        body: input.body,
        mentions: {
          create: input.mentionIds.map((membershipId) => ({ organizationId: input.organizationId, membershipId })),
        },
      },
      include: WITH_AUTHOR,
    }),
  );
}

export function getCommentById(organizationId: string, id: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.comment.findFirst({ where: { id, organizationId }, include: WITH_AUTHOR }),
  );
}

export function listCommentsForRecord(organizationId: string, parent: CommentParent, parentId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.comment.findMany({
      where: { organizationId, [COLUMN[parent]]: parentId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: WITH_AUTHOR,
    }),
  );
}

export function updateCommentRecord(
  organizationId: string,
  id: string,
  body: string,
  addMentionIds: string[],
  removeMentionIds: string[],
) {
  return withOrgContext(organizationId, async (tx) => {
    if (removeMentionIds.length > 0) {
      await tx.commentMention.deleteMany({ where: { organizationId, commentId: id, membershipId: { in: removeMentionIds } } });
    }
    if (addMentionIds.length > 0) {
      await tx.commentMention.createMany({
        data: addMentionIds.map((membershipId) => ({ organizationId, commentId: id, membershipId })),
        skipDuplicates: true,
      });
    }
    return tx.comment.update({ where: { id }, data: { body, editedAt: new Date() }, include: WITH_AUTHOR });
  });
}

/** Soft delete: the row stays so the thread keeps its shape; the text and the mentions are removed. */
export function softDeleteComment(organizationId: string, id: string, deletedByMembershipId: string) {
  return withOrgContext(organizationId, async (tx) => {
    await tx.commentMention.deleteMany({ where: { organizationId, commentId: id } });
    return tx.comment.update({
      where: { id },
      data: { body: "", deletedAt: new Date(), deletedByMembershipId },
      include: WITH_AUTHOR,
    });
  });
}

export function addFollow(organizationId: string, membershipId: string, parent: CommentParent, parentId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.recordFollow.createMany({
      data: [{ organizationId, membershipId, [COLUMN[parent]]: parentId }],
      skipDuplicates: true,
    }),
  );
}

export function removeFollow(organizationId: string, membershipId: string, parent: CommentParent, parentId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.recordFollow.deleteMany({ where: { organizationId, membershipId, [COLUMN[parent]]: parentId } }),
  );
}

export async function listFollowerIds(organizationId: string, parent: CommentParent, parentId: string): Promise<string[]> {
  const rows = await withOrgContext(organizationId, (tx) =>
    tx.recordFollow.findMany({ where: { organizationId, [COLUMN[parent]]: parentId }, select: { membershipId: true } }),
  );
  return rows.map((r) => r.membershipId);
}

export async function isFollowing(organizationId: string, membershipId: string, parent: CommentParent, parentId: string) {
  const row = await withOrgContext(organizationId, (tx) =>
    tx.recordFollow.findFirst({ where: { organizationId, membershipId, [COLUMN[parent]]: parentId }, select: { id: true } }),
  );
  return row !== null;
}
