import { createHash } from "node:crypto";
import { adminDb } from "../db/adminClient";
import { withOrgContext } from "../db/orgScopedClient";
import { recordAuditEvent } from "../repositories/auditEvents";
import { getStorageDriver } from "../storage";

/**
 * Chat and data protection (FIG-1385, B6.27; Kenya DPA, the same rules as the rest of the CRM, docs/PRIVACY.md).
 *
 *   retention : an organisation may set how long chat messages are kept (`chatMessages` in the retention settings, in days; kept until
 *               set). The daily `privacy.retention` job removes older messages, with their reactions, mentions and attached files, and
 *               audits the count. A legal hold stops it, as for everything else.
 *   export    : the whole-organisation export (`scripts/export-organization.ts`) includes channels, members, messages, reactions and
 *               attachments, read from this organisation's rows only (the same row-level security as every request).
 *   erasure   : erasing a member (B6.09 calls this) anonymises their messages by default: the text and the author are removed and the
 *               message stays as "removed" so the thread keeps its shape; the policy `DELETE` removes the rows instead. Their reactions,
 *               mentions, memberships, read markers and presence go, their files are deleted, and `@Their Name` in other people's messages
 *               is blanked. An audit entry records what was done (counts, never text or names).
 *   contacts  : erasing a customer contact (eraseContactData) also removes chat messages that name them (email, phone or full name).
 */

const DAY_MS = 86_400_000;

async function deleteChatFiles(organizationId: string, fileIds: string[]): Promise<number> {
  const ids = [...new Set(fileIds)];
  if (ids.length === 0) return 0;
  // A file that is also attached to a record stays; only files that lived in chat go.
  const shared = new Set((await adminDb.attachment.findMany({ where: { organizationId, fileId: { in: ids } }, select: { fileId: true } })).map((a) => a.fileId));
  const stillInChat = new Set((await adminDb.chatMessageAttachment.findMany({ where: { organizationId, fileId: { in: ids } }, select: { fileId: true } })).map((a) => a.fileId));
  const files = await adminDb.file.findMany({ where: { organizationId, id: { in: ids }, purpose: "ATTACHMENT", status: { not: "DELETED" } }, select: { id: true, storageKey: true } });
  let removed = 0;
  for (const f of files) {
    if (shared.has(f.id) || stillInChat.has(f.id)) continue;
    await getStorageDriver().deleteObject(f.storageKey).catch(() => undefined);
    const now = new Date();
    await adminDb.file.update({ where: { id: f.id }, data: { status: "DELETED", deletedAt: now, purgedAt: now } });
    removed += 1;
  }
  return removed;
}

/** Retention: removes messages older than `days` (and what hangs off them). Returns how many. Safe to repeat. */
export async function purgeChatMessages(organizationId: string, olderThan: Date): Promise<number> {
  let total = 0;
  for (;;) {
    const batch = await withOrgContext(organizationId, async (tx) => {
      const rows = await tx.chatMessage.findMany({ where: { organizationId, createdAt: { lt: olderThan } }, select: { id: true }, take: 500, orderBy: { createdAt: "asc" } });
      if (rows.length === 0) return null;
      const ids = rows.map((r) => r.id);
      const files = (await tx.chatMessageAttachment.findMany({ where: { organizationId, messageId: { in: ids } }, select: { fileId: true } })).map((a) => a.fileId);
      await tx.chatMessage.deleteMany({ where: { organizationId, id: { in: ids } } });
      return { count: ids.length, files };
    });
    if (!batch) break;
    await deleteChatFiles(organizationId, batch.files);
    total += batch.count;
  }
  return total;
}

export const retentionCutoff = (now: Date, days: number) => new Date(now.getTime() - days * DAY_MS);

export interface ChatExport {
  channels: Record<string, unknown>[];
  members: Record<string, unknown>[];
  messages: Record<string, unknown>[];
  reactions: Record<string, unknown>[];
  mentions: Record<string, unknown>[];
  attachments: Record<string, unknown>[];
}

/** Everything chat holds for one organisation, as plain rows. Only this organisation's rows are visible to the query. */
export async function exportOrganisationChat(organizationId: string): Promise<ChatExport> {
  return withOrgContext(
    organizationId,
    async (tx) => {
      const where = { organizationId };
      const files = await tx.chatMessageAttachment.findMany({ where, orderBy: { id: "asc" } });
      const names = await tx.file.findMany({ where: { organizationId, id: { in: files.map((f) => f.fileId) } }, select: { id: true, name: true, mimeType: true, sizeBytes: true, status: true } });
      const byId = new Map(names.map((n) => [n.id, n]));
      return {
        channels: await tx.chatChannel.findMany({ where, orderBy: { id: "asc" } }),
        members: await tx.chatChannelMember.findMany({ where, orderBy: { id: "asc" } }),
        messages: await tx.chatMessage.findMany({ where, orderBy: [{ channelId: "asc" }, { seq: "asc" }] }),
        reactions: await tx.chatReaction.findMany({ where, orderBy: { id: "asc" } }),
        mentions: await tx.chatMessageMention.findMany({ where, orderBy: { id: "asc" } }),
        attachments: files.map((f) => ({ ...f, fileName: byId.get(f.fileId)?.name ?? "", mimeType: byId.get(f.fileId)?.mimeType ?? "", sizeBytes: byId.get(f.fileId)?.sizeBytes ?? 0, fileStatus: byId.get(f.fileId)?.status ?? "" })),
      };
    },
    { timeoutMs: 120_000 },
  );
}

export type ErasurePolicy = "ANONYMISE" | "DELETE";

export interface MemberChatErasure {
  policy: ErasurePolicy;
  messagesAnonymised: number;
  messagesDeleted: number;
  mentionsScrubbed: number;
  reactionsRemoved: number;
  membershipsRemoved: number;
  filesDeleted: number;
}

const ERASED_NAME_MIN = 5;
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Erases a member's chat footprint (the offboarding workflow, B6.09, calls this once its approvals are done). See the file comment
 * for the policy. Idempotent: running it again changes nothing more. Writes an audit entry with counts only.
 */
export async function eraseMemberChat(input: { organizationId: string; membershipId: string; actorMembershipId?: string; requestId?: string; policy?: ErasurePolicy; now?: Date }): Promise<MemberChatErasure> {
  const { organizationId, membershipId } = input;
  const policy = input.policy ?? "ANONYMISE";
  const now = input.now ?? new Date();
  const member = await adminDb.membership.findFirst({ where: { id: membershipId, organizationId }, select: { user: { select: { name: true } } } });
  if (!member) throw new Error("No such member in this organisation.");
  const name = member.user.name.trim();
  const result: MemberChatErasure = { policy, messagesAnonymised: 0, messagesDeleted: 0, mentionsScrubbed: 0, reactionsRemoved: 0, membershipsRemoved: 0, filesDeleted: 0 };

  const fileIds = await withOrgContext(
    organizationId,
    async (tx) => {
      const mine = await tx.chatMessage.findMany({ where: { organizationId, authorMembershipId: membershipId, erasedAt: null }, select: { id: true } });
      const ids = mine.map((m) => m.id);
      const files = ids.length ? (await tx.chatMessageAttachment.findMany({ where: { organizationId, messageId: { in: ids } }, select: { fileId: true } })).map((f) => f.fileId) : [];
      if (policy === "DELETE") {
        result.messagesDeleted = (await tx.chatMessage.deleteMany({ where: { organizationId, id: { in: ids } } })).count;
      } else {
        if (ids.length) {
          await tx.chatMessageAttachment.deleteMany({ where: { organizationId, messageId: { in: ids } } });
          await tx.chatMessageMention.deleteMany({ where: { organizationId, messageId: { in: ids } } });
          await tx.chatReaction.deleteMany({ where: { organizationId, messageId: { in: ids } } });
        }
        result.messagesAnonymised = (
          await tx.chatMessage.updateMany({ where: { organizationId, id: { in: ids } }, data: { body: "", cardType: null, cardId: null, authorMembershipId: null, erasedAt: now, updatedAt: now } })
        ).count;
      }
      // What others hold about them: reactions, mentions, and their name typed after an at sign.
      result.reactionsRemoved = (await tx.chatReaction.deleteMany({ where: { organizationId, membershipId } })).count;
      result.mentionsScrubbed = (await tx.chatMessageMention.deleteMany({ where: { organizationId, membershipId } })).count;
      if (name.length >= ERASED_NAME_MIN && name.includes(" ")) {
        const mention = new RegExp(`@${escapeRegExp(name)}`, "gi");
        const named = await tx.chatMessage.findMany({ where: { organizationId, body: { contains: `@${name}`, mode: "insensitive" } }, select: { id: true, body: true } });
        for (const m of named) {
          await tx.chatMessage.update({ where: { id: m.id }, data: { body: m.body.replace(mention, "@[removed]"), updatedAt: now } });
          result.mentionsScrubbed += 1;
        }
      }
      result.membershipsRemoved = (await tx.chatChannelMember.deleteMany({ where: { organizationId, membershipId } })).count;
      await tx.chatReadMarker.deleteMany({ where: { organizationId, membershipId } });
      await tx.chatPresence.deleteMany({ where: { organizationId, membershipId } });
      return files;
    },
    { timeoutMs: 120_000 },
  );
  result.filesDeleted = await deleteChatFiles(organizationId, fileIds);

  await recordAuditEvent({
    organizationId,
    actorMembershipId: input.actorMembershipId,
    action: "chat.member_erased",
    entityType: "ChatChannel",
    metadata: { ...result, requestId: input.requestId ?? null, subject: createHash("sha256").update(`${organizationId}|${membershipId}`).digest("hex").slice(0, 16) },
  });
  return result;
}

/** Contact erasure (customer data subject): chat messages that name the person by email, phone or full name lose their text. */
export async function eraseChatMessagesNaming(organizationId: string, needles: string[], now = new Date()): Promise<number> {
  const wanted = needles.filter((n) => n.length >= 3);
  if (wanted.length === 0) return 0;
  const leftover: string[] = [];
  const count = await withOrgContext(organizationId, async (tx) => {
    const rows = await tx.chatMessage.findMany({ where: { organizationId, erasedAt: null, deletedAt: null, OR: wanted.map((n) => ({ body: { contains: n, mode: "insensitive" as const } })) }, select: { id: true } });
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return 0;
    leftover.push(...(await tx.chatMessageAttachment.findMany({ where: { organizationId, messageId: { in: ids } }, select: { fileId: true } })).map((f) => f.fileId));
    await tx.chatMessageAttachment.deleteMany({ where: { organizationId, messageId: { in: ids } } });
    await tx.chatMessageMention.deleteMany({ where: { organizationId, messageId: { in: ids } } });
    await tx.chatReaction.deleteMany({ where: { organizationId, messageId: { in: ids } } });
    return (await tx.chatMessage.updateMany({ where: { organizationId, id: { in: ids } }, data: { body: "", cardType: null, cardId: null, erasedAt: now, updatedAt: now } })).count;
  });
  await deleteChatFiles(organizationId, leftover);
  return count;
}
