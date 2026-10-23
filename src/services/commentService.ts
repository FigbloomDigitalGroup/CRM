import type { AuthContext } from "../auth/context";
import { hasPermission } from "../auth/context";
import { ForbiddenError, NotFoundError, ValidationError } from "../auth/errors";
import { canSeeDealValue, textForViewer } from "../auth/masking";
import { adminDb } from "../db/adminClient";
import { assertWritable } from "../lib/archive";
import { recordAuditEvent } from "../repositories/auditEvents";
import {
  addFollow,
  createCommentRecord,
  getCommentById,
  isFollowing,
  listCommentsForRecord,
  listFollowerIds,
  parentColumn,
  removeFollow,
  softDeleteComment,
  updateCommentRecord,
  type CommentParent,
} from "../repositories/comments";
import { listOrganizationMemberships, resolveActiveMembership } from "../repositories/memberships";
import { getCompany } from "./companyService";
import { getContact } from "./contactService";
import { getDeal } from "./dealService";
import { getLead } from "./leadService";
import { notifyEvent } from "./notificationService";
import { getTask } from "./taskService";

/**
 * Comments, @mentions and following on records (FIG-1044, B2.15).
 *
 *   read / write : anyone who can open the record (the record's own service decides), on a record that is not archived.
 *   edit         : the author. delete: the author, or Management (`configuration.manage`). Both are soft; the thread keeps its shape.
 *   mentions     : only people who can open the record. Mentioning anyone else is refused, so a mention can never be used to
 *                  reveal a record to someone who may not see it.
 *   text         : plain text only (markup is removed), 1 to 5000 characters. Amounts are hidden from roles without value access.
 *   follow       : commenters and the people they mention follow the record; followers are told about new comments.
 *
 * Notifications reuse the MENTION type, so the member's own notification preference decides in-app and email delivery.
 */

export const MAX_COMMENT_LENGTH = 5000;
const AUDIT_ENTITY = { lead: "Lead", contact: "Contact", company: "Company", deal: "Deal", task: "Task" } as const;
const PATH = { lead: "leads", contact: "contacts", company: "companies", deal: "deals", task: "tasks" } as const;

/** Plain text: markup and control characters removed, line breaks kept, ends trimmed. */
export function cleanCommentBody(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new ValidationError("A comment is required.", [{ path: "body", message: "Write something." }]);
  }
  const text = raw
    .replace(/\r\n?/g, "\n")
    .replace(/<[^>]*>/g, "")
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length === 0) {
    throw new ValidationError("A comment cannot be empty.", [{ path: "body", message: "Write something." }]);
  }
  if (text.length > MAX_COMMENT_LENGTH) {
    throw new ValidationError(`A comment is at most ${MAX_COMMENT_LENGTH} characters.`, [{ path: "body", message: "Too long." }]);
  }
  return text;
}

interface Loaded {
  archivable: Parameters<typeof assertWritable>[2];
  type: Parameters<typeof assertWritable>[1];
  /** A deal whose value this caller may not see: amounts in its comments are hidden. */
  valueHidden: boolean;
}

/** Loads the record, which also proves the caller may open it (404 otherwise). */
async function loadParent(ctx: AuthContext, parent: CommentParent, id: string): Promise<Loaded> {
  switch (parent) {
    case "lead":
      return { archivable: await getLead(ctx, id), type: "lead", valueHidden: false };
    case "contact":
      return { archivable: await getContact(ctx, id), type: "contact", valueHidden: false };
    case "company":
      return { archivable: await getCompany(ctx, id), type: "company", valueHidden: false };
    case "deal":
    {
      const deal = await getDeal(ctx, id);
      return { archivable: deal, type: "deal", valueHidden: !canSeeDealValue(ctx, deal) };
    }
    case "task":
      return { archivable: await getTask(ctx, id), type: "task", valueHidden: false };
  }
}

function parentOf(comment: Record<string, unknown>): { parent: CommentParent; id: string } {
  for (const parent of ["lead", "contact", "company", "deal", "task"] as const) {
    const id = comment[parentColumn(parent)];
    if (typeof id === "string") return { parent, id };
  }
  throw new Error(`Comment ${String(comment.id)} has no record.`);
}

/** The context of another member, to ask whether they could open a record. Null when they are not active here. */
async function contextOfMember(organizationId: string, membershipId: string): Promise<AuthContext | null> {
  const membership = await adminDb.membership.findFirst({ where: { id: membershipId, organizationId }, select: { userId: true } });
  return membership ? resolveActiveMembership(membership.userId, organizationId) : null;
}

async function canOpen(member: AuthContext, parent: CommentParent, id: string): Promise<boolean> {
  try {
    await loadParent(member, parent, id);
    return true;
  } catch {
    return false;
  }
}

/** The people who can be mentioned on this record: active members who could open it. */
export async function listMentionableMembers(ctx: AuthContext, parent: CommentParent, parentId: string) {
  await loadParent(ctx, parent, parentId);
  const members = await listOrganizationMemberships(ctx.organizationId);
  const out: { membershipId: string; name: string; roleName: string }[] = [];
  for (const m of members) {
    if (m.membershipId === ctx.membershipId) continue;
    const member = await contextOfMember(ctx.organizationId, m.membershipId);
    if (member && (await canOpen(member, parent, parentId))) {
      out.push({ membershipId: m.membershipId, name: m.userName, roleName: m.roleName });
    }
  }
  return out;
}

/** Validates the mentioned members: each one active in this organisation and able to open the record. */
async function resolveMentions(
  ctx: AuthContext,
  parent: CommentParent,
  parentId: string,
  mentions: string[] | undefined,
): Promise<{ ids: string[]; contexts: Map<string, AuthContext> }> {
  const ids = [...new Set(mentions ?? [])].filter((id) => id !== ctx.membershipId);
  const contexts = new Map<string, AuthContext>();
  for (const id of ids) {
    const member = await contextOfMember(ctx.organizationId, id);
    if (!member) {
      throw new ValidationError("You can only mention people in this organisation.", [{ path: "mentions", message: "Unknown member." }]);
    }
    if (!(await canOpen(member, parent, parentId))) {
      const name = (await adminDb.membership.findFirst({ where: { id, organizationId: ctx.organizationId }, select: { user: { select: { name: true } } } }))?.user.name ?? "That person";
      throw new ValidationError(`${name} cannot open this record, so they cannot be mentioned on it.`, [
        { path: "mentions", message: "This person does not have access to the record." },
      ]);
    }
    contexts.set(id, member);
  }
  return { ids, contexts };
}

type CommentRow = NonNullable<Awaited<ReturnType<typeof getCommentById>>>;

async function authorNames(organizationId: string, ids: (string | null)[]) {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  const rows = await adminDb.membership.findMany({ where: { organizationId, id: { in: wanted } }, select: { id: true, user: { select: { name: true } } } });
  return new Map(rows.map((r) => [r.id, r.user.name]));
}

function present(ctx: AuthContext, row: CommentRow, names: Map<string, string>, valueHidden: boolean) {
  const deleted = row.deletedAt !== null;
  const mine = row.authorMembershipId === ctx.membershipId;
  return {
    id: row.id,
    authorMembershipId: row.authorMembershipId,
    authorName: row.authorMembershipId ? (names.get(row.authorMembershipId) ?? null) : null,
    body: deleted ? null : valueHidden ? textForViewer({ permissionKeys: [] }, row.body) : row.body,
    deleted,
    edited: row.editedAt !== null && !deleted,
    editedAt: row.editedAt,
    createdAt: row.createdAt,
    mentions: deleted ? [] : row.mentions.map((m) => m.membershipId),
    canEdit: mine && !deleted,
    canDelete: !deleted && (mine || hasPermission(ctx, "configuration.manage")),
  };
}

export async function listComments(ctx: AuthContext, parent: CommentParent, parentId: string) {
  const { valueHidden } = await loadParent(ctx, parent, parentId);
  const rows = await listCommentsForRecord(ctx.organizationId, parent, parentId);
  const names = await authorNames(ctx.organizationId, rows.map((r) => r.authorMembershipId));
  return {
    comments: rows.map((r) => present(ctx, r, names, valueHidden)),
    following: await isFollowing(ctx.organizationId, ctx.membershipId, parent, parentId),
  };
}

async function recordPath(organizationId: string, parent: CommentParent, id: string): Promise<string> {
  const org = await adminDb.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { slug: true } });
  return parent === "task" ? `/o/${org.slug}/tasks#task-${id}` : `/o/${org.slug}/${PATH[parent]}/${id}`;
}

function snippet(text: string): string {
  const flat = text.replace(/\s+/g, " ");
  return flat.length > 140 ? `${flat.slice(0, 137)}...` : flat;
}

/** Tells a person about a comment. The text is cut down and amounts are hidden according to what *they* may see. */
async function tell(
  ctx: AuthContext,
  recipient: AuthContext,
  parent: CommentParent,
  parentId: string,
  commentId: string,
  body: string,
  kind: "mention" | "comment",
) {
  const author = (await authorNames(ctx.organizationId, [ctx.membershipId])).get(ctx.membershipId) ?? "A colleague";
  const noun = parent === "company" ? "a company" : `a ${parent}`;
  await notifyEvent({
    organizationId: ctx.organizationId,
    membershipId: recipient.membershipId,
    type: "MENTION",
    title: kind === "mention" ? `${author} mentioned you on ${noun}` : `${author} commented on ${noun} you follow`,
    body: textForViewer(recipient, snippet(body)),
    entityType: "Comment",
    entityId: commentId,
    path: await recordPath(ctx.organizationId, parent, parentId),
  });
}

export async function addComment(
  ctx: AuthContext,
  parent: CommentParent,
  parentId: string,
  input: { body: unknown; mentions?: string[] },
) {
  const loaded = await loadParent(ctx, parent, parentId);
  assertWritable(ctx, loaded.type, loaded.archivable, "commenting");
  const body = cleanCommentBody(input.body);
  const { ids, contexts } = await resolveMentions(ctx, parent, parentId, input.mentions);

  const row = await createCommentRecord({
    organizationId: ctx.organizationId,
    parent,
    parentId,
    authorMembershipId: ctx.membershipId,
    body,
    mentionIds: ids,
  });
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "comment.added",
    entityType: AUDIT_ENTITY[parent],
    entityId: parentId,
    metadata: { commentId: row.id, mentions: ids.length },
  });

  // The author and everyone mentioned now follow the record.
  await addFollow(ctx.organizationId, ctx.membershipId, parent, parentId);
  for (const id of ids) await addFollow(ctx.organizationId, id, parent, parentId);

  for (const id of ids) await tell(ctx, contexts.get(id)!, parent, parentId, row.id, body, "mention");
  const followers = (await listFollowerIds(ctx.organizationId, parent, parentId)).filter((id) => id !== ctx.membershipId && !ids.includes(id));
  for (const id of followers) {
    const follower = await contextOfMember(ctx.organizationId, id);
    // A follower who has since lost access to the record is not told about it.
    if (follower && (await canOpen(follower, parent, parentId))) await tell(ctx, follower, parent, parentId, row.id, body, "comment");
  }

  const names = await authorNames(ctx.organizationId, [row.authorMembershipId]);
  return present(ctx, row, names, loaded.valueHidden);
}

async function loadOwnComment(ctx: AuthContext, commentId: string) {
  const row = await getCommentById(ctx.organizationId, commentId);
  if (!row) throw new NotFoundError("Comment", commentId);
  const { parent, id } = parentOf(row);
  const loaded = await loadParent(ctx, parent, id); // 404 when the caller cannot open the record
  return { row, parent, parentId: id, loaded };
}

export async function editComment(ctx: AuthContext, commentId: string, input: { body: unknown; mentions?: string[] }) {
  const { row, parent, parentId, loaded } = await loadOwnComment(ctx, commentId);
  if (row.deletedAt) throw new NotFoundError("Comment", commentId);
  if (row.authorMembershipId !== ctx.membershipId) {
    throw new ForbiddenError("comments.edit", { roleKey: ctx.roleKey, organizationId: ctx.organizationId });
  }
  assertWritable(ctx, loaded.type, loaded.archivable, "editing a comment");
  const body = cleanCommentBody(input.body);
  const { ids, contexts } = await resolveMentions(ctx, parent, parentId, input.mentions);
  const before = new Set(row.mentions.map((m) => m.membershipId));
  const added = ids.filter((id) => !before.has(id));
  const removed = [...before].filter((id) => !ids.includes(id));

  const updated = await updateCommentRecord(ctx.organizationId, commentId, body, added, removed);
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "comment.edited",
    entityType: AUDIT_ENTITY[parent],
    entityId: parentId,
    metadata: { commentId },
  });
  for (const id of added) {
    await addFollow(ctx.organizationId, id, parent, parentId);
    await tell(ctx, contexts.get(id)!, parent, parentId, commentId, body, "mention");
  }
  const names = await authorNames(ctx.organizationId, [updated.authorMembershipId]);
  return present(ctx, updated, names, loaded.valueHidden);
}

export async function deleteComment(ctx: AuthContext, commentId: string) {
  const { row, parent, parentId, loaded } = await loadOwnComment(ctx, commentId);
  if (row.deletedAt) return { id: commentId, deleted: true };
  const mine = row.authorMembershipId === ctx.membershipId;
  if (!mine && !hasPermission(ctx, "configuration.manage")) {
    throw new ForbiddenError("comments.delete", { roleKey: ctx.roleKey, organizationId: ctx.organizationId, permissionKeys: ["configuration.manage"] });
  }
  assertWritable(ctx, loaded.type, loaded.archivable, "deleting a comment");
  await softDeleteComment(ctx.organizationId, commentId, ctx.membershipId);
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "comment.deleted",
    entityType: AUDIT_ENTITY[parent],
    entityId: parentId,
    metadata: { commentId, byAuthor: mine },
  });
  return { id: commentId, deleted: true };
}

export async function followRecord(ctx: AuthContext, parent: CommentParent, parentId: string) {
  await loadParent(ctx, parent, parentId);
  await addFollow(ctx.organizationId, ctx.membershipId, parent, parentId);
  return { following: true };
}

export async function unfollowRecord(ctx: AuthContext, parent: CommentParent, parentId: string) {
  await loadParent(ctx, parent, parentId);
  await removeFollow(ctx.organizationId, ctx.membershipId, parent, parentId);
  return { following: false };
}
