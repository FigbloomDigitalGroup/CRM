import { deleteChatFiles } from "./chatPrivacyService";
import { Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { hasPermission, requirePermission } from "../auth/context";
import { ForbiddenError, NotFoundError, ValidationError } from "../auth/errors";
import { canSeeDealValue, textForViewer } from "../auth/masking";
import { canView } from "../auth/permissions";
import { adminDb } from "../db/adminClient";
import { withOrgContext, type OrgScopedClient } from "../db/orgScopedClient";
import { ApiError } from "../lib/apiErrors";
import { buildPage, resolvePaging, type PageRequest } from "../lib/pagination";
import { recordAuditEvent } from "../repositories/auditEvents";
import { resolveActiveMembership } from "../repositories/memberships";
import { requireFeature } from "./featureService";
import { notifyEvent } from "./notificationService";

/**
 * Chat (FIG-1382, B6.24; permissions and masking FIG-1384, B6.26). The rules, in one place (docs/COMMUNICATION.md):
 *
 *   permission : `chat.view` to read, `chat.post` to post, react, start channels and direct messages, `chat.channels.manage`
 *                (Management) to rename, archive and manage members of any channel the person can see. The Communication group
 *                is also a per-organisation toggle (`communication.group`).
 *   channels   : PUBLIC (everyone except a limited member can see and read it; posting needs joining), PRIVATE (members only;
 *                invisible to everyone else, Management included), DIRECT (exactly two people, one conversation per pair),
 *                RECORD (a deal, company or lead: only people who can open the record may join or read, and access is checked on
 *                every call, so a person who loses the record loses the channel).
 *   limited    : a person without `companies.view` (Restricted Technical) sees only the channels they were added to.
 *   messages   : numbered 1, 2, 3 per channel without gaps (the number is taken under a lock on the channel row), so a client
 *                can ask for "everything after N" and never miss or repeat a message. Plain text, 1 to 4000 characters.
 *   cards      : a message may carry a record card. Only the reference is stored; what the card shows is decided for the person
 *                looking (deal value, payments), never for the person who posted it (hard rule 7).
 *   mentions   : stored for people who can read the channel; a notification goes out only to a person who may see the record the
 *                message names (the record channel's record or the card's record), with money hidden by what they may see.
 */

export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_ATTACHMENTS = 10;
export const PRESENCE_TTL_MS = 60_000;
export const CHAT_FEATURE = "communication.group";
export const CHANNEL_KINDS = ["PUBLIC", "PRIVATE", "DIRECT", "RECORD"] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];
export const RECORD_TYPES = ["DEAL", "COMPANY", "LEAD"] as const;
export type RecordType = (typeof RECORD_TYPES)[number];
export const CARD_TYPES = ["DEAL", "COMPANY", "LEAD", "INVOICE"] as const;
export type CardType = (typeof CARD_TYPES)[number];

/** Opens the gate for every chat call: the toggle for the Communication group and the permission. */
export async function gateChat(ctx: AuthContext, key: "chat.view" | "chat.post" = "chat.view") {
  await requireFeature(ctx.organizationId, CHAT_FEATURE);
  requirePermission(ctx, key);
}

/** Restricted Technical (no customer access) sees only the channels they were added to. */
export function isLimitedMember(ctx: Pick<AuthContext, "permissionKeys">): boolean {
  return !ctx.permissionKeys.includes("companies.view");
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** Plain text: markup and control characters removed, line breaks kept, ends trimmed. */
export function cleanMessageBody(raw: unknown, { allowEmpty = false }: { allowEmpty?: boolean } = {}): string {
  if (typeof raw !== "string") {
    if (allowEmpty && raw === undefined) return "";
    throw new ValidationError("A message is required.", [{ path: "body", message: "Write something." }]);
  }
  const text = raw
    .replace(/\r\n?/g, "\n")
    .replace(/<[^>]*>/g, "")
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length === 0 && !allowEmpty) {
    throw new ValidationError("A message cannot be empty.", [{ path: "body", message: "Write something." }]);
  }
  if (text.length > MAX_MESSAGE_LENGTH) {
    throw new ValidationError(`A message is at most ${MAX_MESSAGE_LENGTH} characters.`, [{ path: "body", message: "Too long." }]);
  }
  return text;
}

function cleanChannelName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim() : "";
  if (name.length < 1 || name.length > 80) {
    throw new ValidationError("A channel name is 1 to 80 characters.", [{ path: "name", message: "Give the channel a name." }]);
  }
  return name;
}

function cleanDescription(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const text = String(raw).replace(/<[^>]*>/g, "").trim();
  if (text.length > 300) throw new ValidationError("A description is at most 300 characters.", [{ path: "description", message: "Too long." }]);
  return text || null;
}

function snippet(text: string): string {
  const flat = text.replace(/\s+/g, " ");
  return flat.length > 140 ? `${flat.slice(0, 137)}...` : flat;
}

export function directKey(a: string, b: string): string {
  return [a, b].sort().join(":");
}

// ---------------------------------------------------------------------------
// Records: who may open what
// ---------------------------------------------------------------------------

interface RecordInfo {
  type: CardType;
  id: string;
  /** What the viewer may open. */
  openable: boolean;
  name: string;
  stage?: string | null;
  value?: number | null;
  ownerMembershipId?: string | null;
  invoiceStatus?: string;
  dealId?: string | null;
}

type Ref = { type: CardType; id: string };

const refKey = (r: Ref) => `${r.type}:${r.id}`;

/**
 * Loads the records a set of references point at, in a fixed number of queries, and says for each whether `viewer` may open it.
 * A record that does not exist in the organisation is simply absent from the result.
 */
async function loadRecords(
  tx: OrgScopedClient,
  viewer: Pick<AuthContext, "organizationId" | "membershipId" | "permissionKeys">,
  refs: Ref[],
): Promise<Map<string, RecordInfo>> {
  const out = new Map<string, RecordInfo>();
  const ids = (type: CardType) => [...new Set(refs.filter((r) => r.type === type).map((r) => r.id))];
  const organizationId = viewer.organizationId;
  const dealIds = ids("DEAL");
  const leadIds = ids("LEAD");
  const companyIds = ids("COMPANY");
  const invoiceIds = ids("INVOICE");

  if (dealIds.length > 0) {
    const deals = await tx.deal.findMany({
      where: { organizationId, id: { in: dealIds } },
      select: { id: true, value: true, ownerMembershipId: true, outcome: true, company: { select: { name: true } }, service: { select: { name: true } }, pipelineStage: { select: { name: true } } },
    });
    for (const d of deals) {
      out.set(`DEAL:${d.id}`, {
        type: "DEAL",
        id: d.id,
        openable: canView(viewer, "deals", { ownerMembershipId: d.ownerMembershipId, outcome: d.outcome }),
        name: `${d.company.name}${d.service ? ` · ${d.service.name}` : ""}`,
        stage: d.pipelineStage.name,
        value: d.value === null ? null : Number(d.value),
        ownerMembershipId: d.ownerMembershipId,
      });
    }
  }
  if (leadIds.length > 0) {
    const leads = await tx.lead.findMany({
      where: { organizationId, id: { in: leadIds } },
      select: { id: true, ownerMembershipId: true, company: { select: { name: true } }, contact: { select: { firstName: true, lastName: true } }, leadStatus: { select: { name: true } } },
    });
    for (const l of leads) {
      const person = [l.contact?.firstName, l.contact?.lastName].filter(Boolean).join(" ");
      out.set(`LEAD:${l.id}`, {
        type: "LEAD",
        id: l.id,
        openable: canView(viewer, "leads", { ownerMembershipId: l.ownerMembershipId }),
        name: l.company?.name ?? (person || "Lead"),
        stage: l.leadStatus.name,
        ownerMembershipId: l.ownerMembershipId,
      });
    }
  }
  if (companyIds.length > 0) {
    const companies = await tx.company.findMany({ where: { organizationId, id: { in: companyIds } }, select: { id: true, name: true } });
    for (const c of companies) {
      out.set(`COMPANY:${c.id}`, { type: "COMPANY", id: c.id, openable: canView(viewer, "companies"), name: c.name });
    }
  }
  if (invoiceIds.length > 0) {
    const invoices = await tx.invoice.findMany({
      where: { organizationId, id: { in: invoiceIds } },
      select: { id: true, number: true, amount: true, status: true, dealId: true, company: { select: { name: true } } },
    });
    for (const i of invoices) {
      out.set(`INVOICE:${i.id}`, {
        type: "INVOICE",
        id: i.id,
        // An invoice is a payment: only Finance and Management (hard rule 7).
        openable: viewer.permissionKeys.includes("finance.view.payments"),
        name: `Invoice ${i.number} · ${i.company.name}`,
        stage: i.status,
        value: Number(i.amount),
        invoiceStatus: i.status,
        dealId: i.dealId,
      });
    }
  }
  return out;
}

/** What a record card shows to this viewer. A masked figure is `null` (never a stand-in number); a record they cannot open is `noAccess`. */
export interface CardView {
  type: CardType;
  id: string;
  noAccess: boolean;
  name: string | null;
  stage?: string | null;
  /** Deal value or invoice amount. */
  value?: number | null;
  /** What is still owed on a deal: payments, so Finance and Management only. */
  paymentDue?: number | null;
}

async function outstandingByDeal(tx: OrgScopedClient, organizationId: string, dealIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (dealIds.length === 0) return out;
  const invoices = await tx.invoice.findMany({ where: { organizationId, dealId: { in: dealIds }, status: { not: "VOID" } }, select: { id: true, dealId: true, amount: true } });
  const records = invoices.length
    ? await tx.paymentRecord.findMany({ where: { organizationId, invoiceId: { in: invoices.map((i) => i.id) }, reversedAt: null }, select: { invoiceId: true, amount: true } })
    : [];
  const paid = new Map<string, number>();
  for (const r of records) paid.set(r.invoiceId, (paid.get(r.invoiceId) ?? 0) + Number(r.amount));
  for (const i of invoices) {
    const owed = Math.max(0, Number(i.amount) - (paid.get(i.id) ?? 0));
    out.set(i.dealId!, (out.get(i.dealId!) ?? 0) + owed);
  }
  return out;
}

function toCardViews(ctx: AuthContext, refs: Ref[], records: Map<string, RecordInfo>, owed: Map<string, number>): Map<string, CardView> {
  const out = new Map<string, CardView>();
  const canSeePayments = hasPermission(ctx, "finance.view.payments");
  for (const ref of refs) {
    const key = refKey(ref);
    const rec = records.get(key);
    if (!rec || !rec.openable) {
      out.set(key, { type: ref.type, id: ref.id, noAccess: true, name: null });
      continue;
    }
    const card: CardView = { type: rec.type, id: rec.id, noAccess: false, name: rec.name, stage: rec.stage ?? null };
    if (rec.type === "DEAL") {
      card.value = canSeeDealValue(ctx, { ownerMembershipId: rec.ownerMembershipId ?? null }) ? (rec.value ?? null) : null;
      card.paymentDue = canSeePayments ? (owed.get(rec.id) ?? 0) : null;
    } else if (rec.type === "INVOICE") {
      card.value = canSeePayments ? (rec.value ?? null) : null;
    }
    out.set(key, card);
  }
  return out;
}

/** The records among `refs` that this person may open, as `TYPE:id` keys, in a fixed number of queries. */
export async function openableRecordKeys(tx: OrgScopedClient, ctx: AuthContext, refs: { type: CardType; id: string }[]): Promise<Set<string>> {
  if (refs.length === 0) return new Set();
  const records = await loadRecords(tx, ctx, refs);
  return new Set([...records].filter(([, r]) => r.openable).map(([k]) => k));
}

async function openableRecord(ctx: AuthContext, tx: OrgScopedClient, ref: Ref): Promise<RecordInfo | null> {
  const rec = (await loadRecords(tx, ctx, [ref])).get(refKey(ref));
  return rec && rec.openable ? rec : null;
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

type ChannelRow = Prisma.ChatChannelGetPayload<Record<string, never>>;

interface Access {
  channel: ChannelRow;
  member: { role: string } | null;
  /** May read the messages now (membership, or a public channel for someone who is not limited, and the record for a record channel). */
  canRead: boolean;
}

function notFound(id: string): NotFoundError {
  return new NotFoundError("Channel", id);
}

/** Loads a channel for a caller and decides what they may do. A channel they may not see is a 404, never a 403 (no existence leak). */
async function accessTo(ctx: AuthContext, tx: OrgScopedClient, channelId: string): Promise<Access> {
  const channel = await tx.chatChannel.findFirst({ where: { id: channelId, organizationId: ctx.organizationId } });
  if (!channel) throw notFound(channelId);
  const member = await tx.chatChannelMember.findFirst({ where: { channelId, membershipId: ctx.membershipId, organizationId: ctx.organizationId }, select: { role: true } });
  let canRead = false;
  if (channel.kind === "PUBLIC") canRead = !!member || !isLimitedMember(ctx);
  else canRead = !!member;
  if (canRead && channel.kind === "RECORD") {
    canRead = (await openableRecord(ctx, tx, { type: channel.recordType as RecordType, id: channel.recordId! })) !== null;
  }
  return { channel, member, canRead };
}

async function readable(ctx: AuthContext, tx: OrgScopedClient, channelId: string): Promise<Access> {
  const access = await accessTo(ctx, tx, channelId);
  if (!access.canRead) {
    // A record channel the person could join (they can open the record) is visible but not readable until they join.
    throw notFound(channelId);
  }
  return access;
}

async function postable(ctx: AuthContext, tx: OrgScopedClient, channelId: string): Promise<Access> {
  const access = await readable(ctx, tx, channelId);
  if (!access.member) throw new ValidationError("Join the channel to post in it.", [{ path: "channelId", message: "You are not a member of this channel." }]);
  if (access.channel.archivedAt) throw new ApiError(409, "VALIDATION_FAILED", "This channel is archived. Restore it to post.");
  return access;
}

function canManage(ctx: AuthContext, access: Access): boolean {
  return access.member?.role === "OWNER" || (hasPermission(ctx, "chat.channels.manage") && access.canRead);
}

async function namesOf(tx: OrgScopedClient, organizationId: string, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => !!id))];
  if (wanted.length === 0) return new Map();
  const rows = await tx.membership.findMany({ where: { organizationId, id: { in: wanted } }, select: { id: true, user: { select: { name: true } } } });
  return new Map(rows.map((r) => [r.id, r.user.name]));
}

export interface ChannelView {
  id: string;
  kind: ChannelKind;
  name: string | null;
  description: string | null;
  private: boolean;
  record: { type: RecordType; id: string } | null;
  archived: boolean;
  memberCount: number;
  joined: boolean;
  role: "OWNER" | "MEMBER" | null;
  unread: number;
  mentions: number;
  lastSeq: number;
  lastMessageAt: Date | null;
  /** DIRECT only: the other person. */
  partner: { membershipId: string; name: string } | null;
  createdAt: Date;
}

interface UnreadRow {
  channel_id: string;
  unread: number;
  mentions: number;
}

/** Unread and mention counts for the channels a member is in, in one query however many channels there are. */
export async function unreadCounts(tx: OrgScopedClient, organizationId: string, membershipId: string, channelIds?: string[]): Promise<Map<string, { unread: number; mentions: number }>> {
  const rows = await tx.$queryRaw<UnreadRow[]>(Prisma.sql`
    SELECT m.channel_id,
      count(x.id)::int AS unread,
      count(mm.id)::int AS mentions
    FROM chat_channel_members m
    LEFT JOIN chat_read_markers rm ON rm.channel_id = m.channel_id AND rm.membership_id = m.membership_id
    LEFT JOIN chat_messages x ON x.channel_id = m.channel_id AND x.seq > COALESCE(rm.last_read_seq, 0)
      AND x.deleted_at IS NULL AND x.author_membership_id IS DISTINCT FROM ${membershipId}
    LEFT JOIN chat_message_mentions mm ON mm.message_id = x.id AND mm.membership_id = ${membershipId}
    WHERE m.organization_id = ${organizationId} AND m.membership_id = ${membershipId}
      ${channelIds ? Prisma.sql`AND m.channel_id IN (${Prisma.join(channelIds)})` : Prisma.empty}
    GROUP BY m.channel_id`);
  return new Map(rows.map((r) => [r.channel_id, { unread: r.unread, mentions: r.mentions }]));
}

/** The channels this person can see, with unread counts. A fixed number of queries however many channels there are. */
async function listChannelsIn(ctx: AuthContext, tx: OrgScopedClient, { includeArchived = false }: { includeArchived?: boolean } = {}): Promise<ChannelView[]> {
  const mine = await tx.chatChannelMember.findMany({ where: { organizationId: ctx.organizationId, membershipId: ctx.membershipId }, select: { channelId: true, role: true } });
  const myIds = mine.map((m) => m.channelId);
  const limited = isLimitedMember(ctx);
  const channels = await tx.chatChannel.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(includeArchived ? {} : { archivedAt: null }),
      OR: [{ id: { in: myIds } }, ...(limited ? [] : [{ kind: { in: ["PUBLIC", "RECORD"] } }])],
    },
    orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }],
  });
  // Record channels: only the ones whose record the person can still open.
  const recordRefs = channels.filter((c) => c.kind === "RECORD").map((c) => ({ type: c.recordType as RecordType, id: c.recordId! }));
  const records = recordRefs.length ? await loadRecords(tx, ctx, recordRefs) : new Map<string, RecordInfo>();
  const visible = channels.filter((c) => c.kind !== "RECORD" || records.get(`${c.recordType}:${c.recordId}`)?.openable);
  const ids = visible.map((c) => c.id);
  const counts = ids.length
    ? await tx.chatChannelMember.groupBy({ by: ["channelId"], where: { organizationId: ctx.organizationId, channelId: { in: ids } }, _count: { _all: true } })
    : [];
  const memberCounts = new Map(counts.map((c) => [c.channelId, c._count._all]));
  const unread = await unreadCounts(tx, ctx.organizationId, ctx.membershipId);
  const directIds = visible.filter((c) => c.kind === "DIRECT").map((c) => c.id);
  const partners = new Map<string, string>();
  if (directIds.length) {
    const rows = await tx.chatChannelMember.findMany({ where: { organizationId: ctx.organizationId, channelId: { in: directIds }, membershipId: { not: ctx.membershipId } }, select: { channelId: true, membershipId: true } });
    for (const r of rows) partners.set(r.channelId, r.membershipId);
  }
  const names = await namesOf(tx, ctx.organizationId, [...partners.values()]);
  const roleOf = new Map(mine.map((m) => [m.channelId, m.role as "OWNER" | "MEMBER"]));
  return visible.map((c) => {
    const partnerId = partners.get(c.id);
    const u = unread.get(c.id);
    return {
      id: c.id,
      kind: c.kind as ChannelKind,
      name: c.kind === "DIRECT" ? (partnerId ? (names.get(partnerId) ?? null) : null) : c.name,
      description: c.description,
      private: c.kind !== "PUBLIC",
      record: c.kind === "RECORD" ? { type: c.recordType as RecordType, id: c.recordId! } : null,
      archived: c.archivedAt !== null,
      memberCount: memberCounts.get(c.id) ?? 0,
      joined: roleOf.has(c.id),
      role: roleOf.get(c.id) ?? null,
      unread: u?.unread ?? 0,
      mentions: u?.mentions ?? 0,
      lastSeq: c.lastSeq,
      lastMessageAt: c.lastMessageAt,
      partner: partnerId ? { membershipId: partnerId, name: names.get(partnerId) ?? "" } : null,
      createdAt: c.createdAt,
    };
  });
}

export async function listChannels(ctx: AuthContext, options: { includeArchived?: boolean } = {}) {
  await gateChat(ctx);
  const items = await withOrgContext(ctx.organizationId, (tx) => listChannelsIn(ctx, tx, options));
  return { items, unreadTotal: items.filter((c) => c.joined).reduce((n, c) => n + c.unread, 0), mentionTotal: items.filter((c) => c.joined).reduce((n, c) => n + c.mentions, 0) };
}

/** The number the sidebar badge shows: unread messages across the channels the person is in. */
export async function getUnreadTotals(ctx: AuthContext) {
  await gateChat(ctx);
  return withOrgContext(ctx.organizationId, async (tx) => {
    const all = await unreadCounts(tx, ctx.organizationId, ctx.membershipId);
    // Record channels count only while the person can still open the record, as in the channel list.
    const recordChannels = all.size ? await tx.chatChannel.findMany({ where: { organizationId: ctx.organizationId, id: { in: [...all.keys()] }, kind: "RECORD" } }) : [];
    const openable = await openableRecordKeys(tx, ctx, recordChannels.map((c) => ({ type: c.recordType as RecordType, id: c.recordId! })));
    const closed = new Set(recordChannels.filter((c) => !openable.has(`${c.recordType}:${c.recordId}`)).map((c) => c.id));
    const counts = new Map([...all].filter(([id]) => !closed.has(id)));
    let unread = 0;
    let mentions = 0;
    for (const v of counts.values()) {
      unread += v.unread;
      mentions += v.mentions;
    }
    return { unread, mentions, channels: Object.fromEntries([...counts].filter(([, v]) => v.unread > 0).map(([k, v]) => [k, v])) };
  });
}

async function channelViewOf(ctx: AuthContext, tx: OrgScopedClient, channelId: string): Promise<ChannelView> {
  const all = await listChannelsIn(ctx, tx, { includeArchived: true });
  const found = all.find((c) => c.id === channelId);
  if (!found) throw notFound(channelId);
  return found;
}

export async function getChannel(ctx: AuthContext, channelId: string) {
  await gateChat(ctx);
  return withOrgContext(ctx.organizationId, async (tx) => {
    const access = await accessTo(ctx, tx, channelId);
    // A record channel is visible to a person who can open the record, so they can join it; the messages stay closed until they do.
    if (!access.canRead && !(access.channel.kind === "RECORD" && !isLimitedMember(ctx) && (await openableRecord(ctx, tx, { type: access.channel.recordType as RecordType, id: access.channel.recordId! })))) {
      throw notFound(channelId);
    }
    return channelViewOf(ctx, tx, channelId);
  });
}

export interface CreateChannelInput {
  kind: ChannelKind;
  name?: string;
  description?: string;
  /** People to add (never the caller). For DIRECT exactly one. */
  memberIds?: string[];
  /** RECORD: the record the channel is about. */
  record?: { type: RecordType; id: string };
}

async function assertActiveMembers(tx: OrgScopedClient, organizationId: string, ids: string[]) {
  if (ids.length === 0) return;
  const rows = await tx.membership.findMany({ where: { organizationId, id: { in: ids }, status: "ACTIVE" }, select: { id: true } });
  if (rows.length !== ids.length) throw new ValidationError("You can only add active people in this organisation.", [{ path: "memberIds", message: "Unknown member." }]);
}

export async function createChannel(ctx: AuthContext, input: CreateChannelInput) {
  await gateChat(ctx, "chat.post");
  if (!CHANNEL_KINDS.includes(input.kind)) throw new ValidationError("Unknown channel kind.", [{ path: "kind", message: "Use PUBLIC, PRIVATE, DIRECT or RECORD." }]);
  const others = [...new Set(input.memberIds ?? [])].filter((id) => id !== ctx.membershipId);
  const created = await withOrgContext(ctx.organizationId, async (tx) => {
    await assertActiveMembers(tx, ctx.organizationId, others);
    const base = { organizationId: ctx.organizationId, createdByMembershipId: ctx.membershipId };
    const memberRows = (channelId: string) => [
      { organizationId: ctx.organizationId, channelId, membershipId: ctx.membershipId, role: "OWNER", addedByMembershipId: ctx.membershipId },
      ...others.map((membershipId) => ({ organizationId: ctx.organizationId, channelId, membershipId, role: "MEMBER", addedByMembershipId: ctx.membershipId })),
    ];

    if (input.kind === "DIRECT") {
      if (others.length !== 1) throw new ValidationError("A direct message is with exactly one other person.", [{ path: "memberIds", message: "Pick one person." }]);
      const key = directKey(ctx.membershipId, others[0]!);
      const existing = await tx.chatChannel.findFirst({ where: { organizationId: ctx.organizationId, directKey: key } });
      if (existing) return { id: existing.id, created: false, kind: "DIRECT" as const };
      const channel = await tx.chatChannel.create({ data: { ...base, kind: "DIRECT", directKey: key } });
      await tx.chatChannelMember.createMany({ data: memberRows(channel.id).map((m) => ({ ...m, role: "MEMBER" })) });
      return { id: channel.id, created: true, kind: "DIRECT" as const };
    }

    if (input.kind === "RECORD") {
      if (!input.record || !RECORD_TYPES.includes(input.record.type)) throw new ValidationError("A record channel needs a deal, company or lead.", [{ path: "record", message: "Pick a record." }]);
      const rec = await openableRecord(ctx, tx, input.record);
      if (!rec) throw new NotFoundError(input.record.type, input.record.id);
      const existing = await tx.chatChannel.findFirst({ where: { organizationId: ctx.organizationId, kind: "RECORD", recordType: input.record.type, recordId: input.record.id, archivedAt: null } });
      if (existing) {
        await tx.chatChannelMember.upsert({
          where: { channelId_membershipId: { channelId: existing.id, membershipId: ctx.membershipId } },
          create: { organizationId: ctx.organizationId, channelId: existing.id, membershipId: ctx.membershipId, role: "MEMBER", addedByMembershipId: ctx.membershipId },
          update: {},
        });
        return { id: existing.id, created: false, kind: "RECORD" as const };
      }
      const channel = await tx.chatChannel.create({
        data: { ...base, kind: "RECORD", recordType: input.record.type, recordId: input.record.id, name: input.name ? cleanChannelName(input.name) : rec.name.slice(0, 80), description: cleanDescription(input.description) },
      });
      // Teammates must be able to open the record to be added to its channel.
      for (const id of others) {
        const member = await contextOfMember(ctx.organizationId, id);
        if (!member || !(await openableRecord(member, tx, input.record))) throw new ValidationError("That person cannot open this record, so they cannot join its channel.", [{ path: "memberIds", message: "No access to the record." }]);
      }
      await tx.chatChannelMember.createMany({ data: memberRows(channel.id) });
      return { id: channel.id, created: true, kind: "RECORD" as const };
    }

    const name = cleanChannelName(input.name);
    const clash = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM chat_channels WHERE organization_id = ${ctx.organizationId} AND kind IN ('PUBLIC','PRIVATE') AND archived_at IS NULL AND lower(name) = lower(${name}) LIMIT 1`);
    if (clash.length) throw new ApiError(409, "VALIDATION_FAILED", `A channel called "${name}" already exists.`);
    const channel = await tx.chatChannel.create({ data: { ...base, kind: input.kind, name, description: cleanDescription(input.description) } });
    await tx.chatChannelMember.createMany({ data: memberRows(channel.id) });
    return { id: channel.id, created: true, kind: input.kind };
  });
  const view = await withOrgContext(ctx.organizationId, (tx) => channelViewOf(ctx, tx, created.id));
  if (created.created) {
    await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "chat.channel_created", entityType: "ChatChannel", entityId: created.id, metadata: { kind: created.kind, ...(created.kind === "DIRECT" ? {} : { name: view.name }), members: others.length + 1 } });
  }
  return { ...view, created: created.created };
}

export async function updateChannel(ctx: AuthContext, channelId: string, patch: { name?: string; description?: string | null; archived?: boolean }) {
  await gateChat(ctx, "chat.post");
  const result = await withOrgContext(ctx.organizationId, async (tx) => {
    const access = await readable(ctx, tx, channelId);
    if (!canManage(ctx, access)) throw new ForbiddenError("chat.channels.manage", { roleKey: ctx.roleKey, organizationId: ctx.organizationId, permissionKeys: ["chat.channels.manage"] });
    const { channel } = access;
    const data: Prisma.ChatChannelUncheckedUpdateInput = {};
    const events: { action: string; metadata: Prisma.InputJsonValue }[] = [];
    if (patch.name !== undefined) {
      if (channel.kind === "DIRECT") throw new ValidationError("A direct message has no name.", [{ path: "name", message: "Not allowed." }]);
      const name = cleanChannelName(patch.name);
      if (name !== channel.name) {
        const clash = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM chat_channels WHERE organization_id = ${ctx.organizationId} AND kind IN ('PUBLIC','PRIVATE') AND archived_at IS NULL AND lower(name) = lower(${name}) AND id <> ${channelId} LIMIT 1`);
        if (clash.length) throw new ApiError(409, "VALIDATION_FAILED", `A channel called "${name}" already exists.`);
        data.name = name;
        events.push({ action: "chat.channel_renamed", metadata: { from: channel.name, to: name } });
      }
    }
    if (patch.description !== undefined) data.description = cleanDescription(patch.description);
    if (patch.archived !== undefined) {
      if (channel.kind === "DIRECT") throw new ValidationError("A direct message cannot be archived.", [{ path: "archived", message: "Not allowed." }]);
      if (patch.archived && !channel.archivedAt) {
        data.archivedAt = new Date();
        data.archivedByMembershipId = ctx.membershipId;
        events.push({ action: "chat.channel_archived", metadata: {} });
      } else if (!patch.archived && channel.archivedAt) {
        data.archivedAt = null;
        data.archivedByMembershipId = null;
        events.push({ action: "chat.channel_restored", metadata: {} });
      }
    }
    if (Object.keys(data).length > 0) await tx.chatChannel.update({ where: { id: channelId }, data });
    return events;
  });
  for (const e of result) await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: e.action, entityType: "ChatChannel", entityId: channelId, metadata: e.metadata });
  return withOrgContext(ctx.organizationId, (tx) => channelViewOf(ctx, tx, channelId));
}

/** Deletes an archived channel and everything in it. Archive first: deleting is a second, deliberate step. */
export async function deleteChannel(ctx: AuthContext, channelId: string) {
  await gateChat(ctx, "chat.post");
  const meta = await withOrgContext(ctx.organizationId, async (tx) => {
    const access = await readable(ctx, tx, channelId);
    if (!canManage(ctx, access)) throw new ForbiddenError("chat.channels.manage", { roleKey: ctx.roleKey, organizationId: ctx.organizationId, permissionKeys: ["chat.channels.manage"] });
    if (!access.channel.archivedAt) throw new ValidationError("Archive the channel before deleting it.", [{ path: "channelId", message: "Not archived." }]);
    const messages = await tx.chatMessage.count({ where: { channelId } });
    const channelMessages = await tx.chatMessage.findMany({ where: { channelId, organizationId: ctx.organizationId }, select: { id: true } });
    const fileIds = (await tx.chatMessageAttachment.findMany({ where: { organizationId: ctx.organizationId, messageId: { in: channelMessages.map((m) => m.id) } }, select: { fileId: true } })).map((a) => a.fileId);
    await tx.chatChannel.delete({ where: { id: channelId } });
    return { kind: access.channel.kind, name: access.channel.name, messages, fileIds };
  });
  // The files that lived only in this channel go with it (a file also attached to a record stays).
  await deleteChatFiles(ctx.organizationId, meta.fileIds);
  const { fileIds: _files, ...auditMeta } = meta;
  void _files;
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "chat.channel_deleted", entityType: "ChatChannel", entityId: channelId, metadata: auditMeta });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

/** The context of another member, to ask what they could open. Null when they are not active here. */
export async function contextOfMember(organizationId: string, membershipId: string): Promise<AuthContext | null> {
  const membership = await adminDb.membership.findFirst({ where: { id: membershipId, organizationId }, select: { userId: true } });
  return membership ? resolveActiveMembership(membership.userId, organizationId) : null;
}

export async function listMembers(ctx: AuthContext, channelId: string) {
  await gateChat(ctx);
  return withOrgContext(ctx.organizationId, async (tx) => {
    await readable(ctx, tx, channelId);
    const rows = await tx.chatChannelMember.findMany({ where: { organizationId: ctx.organizationId, channelId }, orderBy: [{ joinedAt: "asc" }, { id: "asc" }] });
    const names = await namesOf(tx, ctx.organizationId, rows.map((r) => r.membershipId));
    const cutoff = new Date(Date.now() - PRESENCE_TTL_MS);
    const presence = await tx.chatPresence.findMany({ where: { organizationId: ctx.organizationId, membershipId: { in: rows.map((r) => r.membershipId) }, lastSeenAt: { gt: cutoff } } });
    const status = new Map(presence.map((p) => [p.membershipId, p.status]));
    return { items: rows.map((r) => ({ membershipId: r.membershipId, name: names.get(r.membershipId) ?? "", role: r.role, joinedAt: r.joinedAt, presence: (status.get(r.membershipId) ?? "OFFLINE") as "ONLINE" | "AWAY" | "OFFLINE" })) };
  });
}

/** Everyone who can be added or messaged: active people in the organisation, with presence. */
export async function listPeople(ctx: AuthContext) {
  await gateChat(ctx);
  return withOrgContext(ctx.organizationId, async (tx) => {
    const members = await tx.membership.findMany({ where: { organizationId: ctx.organizationId, status: "ACTIVE" }, select: { id: true, user: { select: { name: true } }, role: { select: { name: true } } }, orderBy: { id: "asc" } });
    const cutoff = new Date(Date.now() - PRESENCE_TTL_MS);
    const presence = await tx.chatPresence.findMany({ where: { organizationId: ctx.organizationId, lastSeenAt: { gt: cutoff } } });
    const status = new Map(presence.map((p) => [p.membershipId, p.status]));
    return {
      items: members
        .map((m) => ({ membershipId: m.id, name: m.user.name, roleName: m.role.name, presence: (status.get(m.id) ?? "OFFLINE") as "ONLINE" | "AWAY" | "OFFLINE", you: m.id === ctx.membershipId }))
        .sort((a, b) => a.name.localeCompare(b.name) || a.membershipId.localeCompare(b.membershipId)),
    };
  });
}

async function addMemberRows(ctx: AuthContext, tx: OrgScopedClient, access: Access, ids: string[]) {
  for (const id of ids) {
    if (access.channel.kind === "RECORD") {
      const member = await contextOfMember(ctx.organizationId, id);
      if (!member || !(await openableRecord(member, tx, { type: access.channel.recordType as RecordType, id: access.channel.recordId! }))) {
        throw new ValidationError("That person cannot open this record, so they cannot join its channel.", [{ path: "membershipIds", message: "No access to the record." }]);
      }
    }
  }
  await assertActiveMembers(tx, ctx.organizationId, ids);
  await tx.chatChannelMember.createMany({ data: ids.map((membershipId) => ({ organizationId: ctx.organizationId, channelId: access.channel.id, membershipId, role: "MEMBER", addedByMembershipId: ctx.membershipId })), skipDuplicates: true });
  // A newcomer starts with nothing unread: the marker is set to the last message.
  for (const membershipId of ids) {
    await tx.chatReadMarker.upsert({
      where: { channelId_membershipId: { channelId: access.channel.id, membershipId } },
      create: { organizationId: ctx.organizationId, channelId: access.channel.id, membershipId, lastReadSeq: access.channel.lastSeq },
      update: {},
    });
  }
}

export async function addMembers(ctx: AuthContext, channelId: string, membershipIds: string[]) {
  await gateChat(ctx, "chat.post");
  const ids = [...new Set(membershipIds)].filter((id) => id !== ctx.membershipId);
  const added = await withOrgContext(ctx.organizationId, async (tx) => {
    const access = await readable(ctx, tx, channelId);
    if (access.channel.kind === "DIRECT") throw new ValidationError("A direct message has two people and no more.", [{ path: "channelId", message: "Not allowed." }]);
    if (!canManage(ctx, access)) throw new ForbiddenError("chat.channels.manage", { roleKey: ctx.roleKey, organizationId: ctx.organizationId, permissionKeys: ["chat.channels.manage"] });
    const existing = new Set((await tx.chatChannelMember.findMany({ where: { channelId, membershipId: { in: ids } }, select: { membershipId: true } })).map((m) => m.membershipId));
    const fresh = ids.filter((id) => !existing.has(id));
    await addMemberRows(ctx, tx, access, fresh);
    return fresh;
  });
  for (const id of added) await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "chat.member_added", entityType: "ChatChannel", entityId: channelId, metadata: { membershipId: id } });
  return listMembers(ctx, channelId);
}

async function removeMemberRow(tx: OrgScopedClient, organizationId: string, channelId: string, membershipId: string) {
  await tx.chatChannelMember.deleteMany({ where: { organizationId, channelId, membershipId } });
  await tx.chatReadMarker.deleteMany({ where: { organizationId, channelId, membershipId } });
  await tx.chatPresence.updateMany({ where: { organizationId, membershipId, typingChannelId: channelId }, data: { typingChannelId: null, typingUntil: null } });
  // The channel never loses its last owner while people remain: the longest-standing member takes over.
  const left = await tx.chatChannelMember.findMany({ where: { organizationId, channelId }, orderBy: [{ joinedAt: "asc" }, { id: "asc" }] });
  if (left.length > 0 && !left.some((m) => m.role === "OWNER")) await tx.chatChannelMember.update({ where: { id: left[0]!.id }, data: { role: "OWNER" } });
}

export async function removeMember(ctx: AuthContext, channelId: string, membershipId: string) {
  await gateChat(ctx);
  const self = membershipId === ctx.membershipId;
  await withOrgContext(ctx.organizationId, async (tx) => {
    const access = self ? await accessTo(ctx, tx, channelId) : await readable(ctx, tx, channelId);
    if (access.channel.kind === "DIRECT") throw new ValidationError("A direct message cannot be left or changed.", [{ path: "channelId", message: "Not allowed." }]);
    if (self) {
      if (!access.member) throw notFound(channelId);
    } else {
      requirePermission(ctx, "chat.post");
      if (!canManage(ctx, access)) throw new ForbiddenError("chat.channels.manage", { roleKey: ctx.roleKey, organizationId: ctx.organizationId, permissionKeys: ["chat.channels.manage"] });
      const target = await tx.chatChannelMember.findFirst({ where: { channelId, membershipId } });
      if (!target) throw new NotFoundError("Member", membershipId);
    }
    await removeMemberRow(tx, ctx.organizationId, channelId, membershipId);
  });
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: self ? "chat.member_left" : "chat.member_removed", entityType: "ChatChannel", entityId: channelId, metadata: { membershipId } });
  return { ok: true };
}

/** Joins a public channel, or a record channel the person can open the record of. Private channels need an invitation. */
export async function joinChannel(ctx: AuthContext, channelId: string) {
  await gateChat(ctx, "chat.post");
  const joined = await withOrgContext(ctx.organizationId, async (tx) => {
    const access = await accessTo(ctx, tx, channelId);
    const { channel } = access;
    if (access.member) return false;
    if (channel.archivedAt) throw new ApiError(409, "VALIDATION_FAILED", "This channel is archived.");
    if (channel.kind === "PUBLIC") {
      if (isLimitedMember(ctx)) throw notFound(channelId);
    } else if (channel.kind === "RECORD") {
      if (isLimitedMember(ctx) || !(await openableRecord(ctx, tx, { type: channel.recordType as RecordType, id: channel.recordId! }))) throw notFound(channelId);
    } else {
      throw notFound(channelId);
    }
    await addMemberRows(ctx, tx, { ...access, canRead: true }, [ctx.membershipId]);
    return true;
  });
  if (joined) await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "chat.member_joined", entityType: "ChatChannel", entityId: channelId, metadata: { membershipId: ctx.membershipId } });
  return withOrgContext(ctx.organizationId, (tx) => channelViewOf(ctx, tx, channelId));
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export interface MessageView {
  id: string;
  channelId: string;
  seq: number;
  authorMembershipId: string | null;
  authorName: string | null;
  /** Null for a deleted or erased message. Money is hidden according to what the viewer may see. */
  body: string | null;
  deleted: boolean;
  erased: boolean;
  card: CardView | null;
  mentions: string[];
  attachments: { fileId: string; name: string; sizeBytes: number; mimeType: string }[];
  reactions: { emoji: string; count: number; mine: boolean }[];
  canDelete: boolean;
  createdAt: Date;
  updatedAt: Date;
}

type MessageRow = Prisma.ChatMessageGetPayload<Record<string, never>>;

/** Turns message rows into what this viewer may see, in a fixed number of queries. */
export async function presentMessages(ctx: AuthContext, tx: OrgScopedClient, rows: MessageRow[], channelRecord?: { type: RecordType; id: string } | null): Promise<MessageView[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const org = ctx.organizationId;
  const [mentions, attachments, reactions, names] = await Promise.all([
    tx.chatMessageMention.findMany({ where: { organizationId: org, messageId: { in: ids } }, select: { messageId: true, membershipId: true } }),
    tx.chatMessageAttachment.findMany({ where: { organizationId: org, messageId: { in: ids } }, select: { messageId: true, fileId: true } }),
    tx.chatReaction.findMany({ where: { organizationId: org, messageId: { in: ids } }, select: { messageId: true, emoji: true, membershipId: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    namesOf(tx, org, rows.map((r) => r.authorMembershipId)),
  ]);
  const fileIds = [...new Set(attachments.map((a) => a.fileId))];
  const files = fileIds.length ? await tx.file.findMany({ where: { organizationId: org, id: { in: fileIds } }, select: { id: true, name: true, sizeBytes: true, mimeType: true, status: true } }) : [];
  const fileById = new Map(files.map((f) => [f.id, f]));
  const refs: Ref[] = rows.filter((r) => r.cardType && !r.deletedAt && !r.erasedAt).map((r) => ({ type: r.cardType as CardType, id: r.cardId! }));
  if (channelRecord) refs.push({ type: channelRecord.type, id: channelRecord.id });
  const records = refs.length ? await loadRecords(tx, ctx, refs) : new Map<string, RecordInfo>();
  const owed = hasPermission(ctx, "finance.view.payments")
    ? await outstandingByDeal(tx, org, refs.filter((r) => r.type === "DEAL").map((r) => r.id))
    : new Map<string, number>();
  const cards = toCardViews(ctx, refs, records, owed);
  // Text typed in a deal's own channel, or sent with a deal or invoice card, can name that deal's figures: hide them from someone who
  // may not see them. Text in an ordinary channel is the author's own words and is left alone, as comments are.
  const dealHidden = (id: string) => !canSeeDealValue(ctx, { ownerMembershipId: records.get(`DEAL:${id}`)?.ownerMembershipId ?? null });
  const channelDealHidden = channelRecord?.type === "DEAL" ? dealHidden(channelRecord.id) : false;
  const group = <T extends { messageId: string }>(list: T[]) => {
    const m = new Map<string, T[]>();
    for (const x of list) m.set(x.messageId, [...(m.get(x.messageId) ?? []), x]);
    return m;
  };
  const mentionsBy = group(mentions);
  const attachmentsBy = group(attachments);
  const reactionsBy = group(reactions);
  const manager = hasPermission(ctx, "chat.channels.manage");
  return rows.map((r) => {
    const gone = r.deletedAt !== null || r.erasedAt !== null;
    const reactionList = new Map<string, { count: number; mine: boolean }>();
    for (const x of reactionsBy.get(r.id) ?? []) {
      const cur = reactionList.get(x.emoji) ?? { count: 0, mine: false };
      reactionList.set(x.emoji, { count: cur.count + 1, mine: cur.mine || x.membershipId === ctx.membershipId });
    }
    const card = !gone && r.cardType ? (cards.get(`${r.cardType}:${r.cardId}`) ?? null) : null;
    const moneyHidden =
      channelDealHidden ||
      (r.cardType === "DEAL" && dealHidden(r.cardId!)) ||
      (r.cardType === "INVOICE" && !hasPermission(ctx, "finance.view.payments"));
    return {
      id: r.id,
      channelId: r.channelId,
      seq: r.seq,
      authorMembershipId: r.erasedAt ? null : r.authorMembershipId,
      authorName: r.authorMembershipId && !r.erasedAt ? (names.get(r.authorMembershipId) ?? null) : null,
      body: gone ? null : moneyHidden ? textForViewer({ permissionKeys: [] }, r.body) : r.body,
      deleted: r.deletedAt !== null,
      erased: r.erasedAt !== null,
      card,
      mentions: gone ? [] : (mentionsBy.get(r.id) ?? []).map((m) => m.membershipId),
      attachments: gone
        ? []
        : (attachmentsBy.get(r.id) ?? []).flatMap((a) => {
            const f = fileById.get(a.fileId);
            return f && f.status === "READY" ? [{ fileId: f.id, name: f.name, sizeBytes: f.sizeBytes, mimeType: f.mimeType }] : [];
          }),
      reactions: gone ? [] : [...reactionList].map(([emoji, v]) => ({ emoji, ...v })),
      canDelete: !gone && (r.authorMembershipId === ctx.membershipId || manager),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  });
}

function recordOf(channel: ChannelRow): { type: RecordType; id: string } | null {
  return channel.kind === "RECORD" ? { type: channel.recordType as RecordType, id: channel.recordId! } : null;
}

/** A page of messages, newest page first by default (`before`), or everything after a number (`after`), always returned oldest first. */
export async function listMessages(ctx: AuthContext, channelId: string, query: { before?: number; after?: number; limit?: number } = {}) {
  await gateChat(ctx);
  const limit = Math.min(Math.max(Math.floor(query.limit ?? 50), 1), 100);
  return withOrgContext(ctx.organizationId, async (tx) => {
    const access = await readable(ctx, tx, channelId);
    const where: Prisma.ChatMessageWhereInput = { organizationId: ctx.organizationId, channelId };
    let rows: MessageRow[];
    if (query.after !== undefined) {
      rows = await tx.chatMessage.findMany({ where: { ...where, seq: { gt: query.after } }, orderBy: { seq: "asc" }, take: limit + 1 });
    } else {
      rows = (await tx.chatMessage.findMany({ where: { ...where, ...(query.before !== undefined ? { seq: { lt: query.before } } : {}) }, orderBy: { seq: "desc" }, take: limit + 1 })).reverse();
    }
    const more = rows.length > limit;
    if (more) rows = query.after !== undefined ? rows.slice(0, limit) : rows.slice(1);
    const items = await presentMessages(ctx, tx, rows, recordOf(access.channel));
    return { items, hasMore: more, lastSeq: access.channel.lastSeq, oldestSeq: items[0]?.seq ?? null, newestSeq: items[items.length - 1]?.seq ?? null };
  });
}

export interface PostMessageInput {
  body?: string;
  card?: { type: CardType; id: string };
  mentions?: string[];
  fileIds?: string[];
}

export async function postMessage(ctx: AuthContext, channelId: string, input: PostMessageInput) {
  await gateChat(ctx, "chat.post");
  const fileIds = [...new Set(input.fileIds ?? [])];
  if (fileIds.length > MAX_ATTACHMENTS) throw new ValidationError(`At most ${MAX_ATTACHMENTS} attachments.`, [{ path: "fileIds", message: "Too many." }]);
  const body = cleanMessageBody(input.body, { allowEmpty: !!input.card || fileIds.length > 0 });
  if (input.card && !CARD_TYPES.includes(input.card.type)) throw new ValidationError("Unknown card type.", [{ path: "card.type", message: "Use DEAL, COMPANY, LEAD or INVOICE." }]);

  const result = await withOrgContext(ctx.organizationId, async (tx) => {
    const access = await postable(ctx, tx, channelId);
    if (input.card) {
      const rec = await openableRecord(ctx, tx, input.card);
      if (!rec) throw new NotFoundError(input.card.type, input.card.id);
    }
    if (fileIds.length) {
      const files = await tx.file.findMany({ where: { organizationId: ctx.organizationId, id: { in: fileIds }, purpose: "ATTACHMENT", status: "READY", ownerMembershipId: ctx.membershipId }, select: { id: true } });
      if (files.length !== fileIds.length) throw new ValidationError("An attachment is not ready or is not yours. Upload it again.", [{ path: "fileIds", message: "File unavailable." }]);
    }
    // Who can be mentioned: people who can read this channel.
    const wanted = [...new Set(input.mentions ?? [])].filter((id) => id !== ctx.membershipId);
    let mentionIds: string[] = [];
    if (wanted.length) {
      const people = await tx.membership.findMany({ where: { organizationId: ctx.organizationId, id: { in: wanted }, status: "ACTIVE" }, select: { id: true } });
      if (people.length !== wanted.length) throw new ValidationError("You can only mention people in this organisation.", [{ path: "mentions", message: "Unknown member." }]);
      if (access.channel.kind === "PUBLIC") mentionIds = wanted;
      else {
        const members = new Set((await tx.chatChannelMember.findMany({ where: { channelId, membershipId: { in: wanted } }, select: { membershipId: true } })).map((m) => m.membershipId));
        mentionIds = wanted.filter((id) => members.has(id));
      }
    }
    // The next number, taken under the channel's row lock: numbers are gapless and in commit order.
    const [{ last_seq }] = await tx.$queryRaw<{ last_seq: number }[]>(Prisma.sql`UPDATE chat_channels SET last_seq = last_seq + 1, last_message_at = now(), updated_at = now() WHERE id = ${channelId} AND organization_id = ${ctx.organizationId} RETURNING last_seq`);
    const message = await tx.chatMessage.create({ data: { organizationId: ctx.organizationId, channelId, seq: last_seq, authorMembershipId: ctx.membershipId, body, cardType: input.card?.type ?? null, cardId: input.card?.id ?? null } });
    if (mentionIds.length) await tx.chatMessageMention.createMany({ data: mentionIds.map((membershipId) => ({ organizationId: ctx.organizationId, messageId: message.id, membershipId })) });
    if (fileIds.length) await tx.chatMessageAttachment.createMany({ data: fileIds.map((fileId) => ({ organizationId: ctx.organizationId, messageId: message.id, fileId })) });
    // Posting counts as having read everything up to it.
    await tx.chatReadMarker.upsert({
      where: { channelId_membershipId: { channelId, membershipId: ctx.membershipId } },
      create: { organizationId: ctx.organizationId, channelId, membershipId: ctx.membershipId, lastReadSeq: last_seq },
      update: { lastReadSeq: last_seq },
    });
    const [view] = await presentMessages(ctx, tx, [message], recordOf(access.channel));
    return { view: view!, id: message.id };
  });
  // Mentions and direct messages are delivered by a job, so posting stays fast and a failed delivery is retried.
  await enqueueChatNotification(ctx, result.id);
  return result.view;
}

async function enqueueChatNotification(ctx: AuthContext, messageId: string) {
  try {
    const { enqueueJobFor } = await import("../jobs/runner");
    await enqueueJobFor({ organizationId: ctx.organizationId, type: CHAT_NOTIFY_JOB, payload: { messageId }, createdByMembershipId: ctx.membershipId });
  } catch {
    // Delivery is best-effort: the message is already saved.
  }
}

export const CHAT_NOTIFY_JOB = "chat.notify";

/**
 * The job body: a notification for each person mentioned, and for the other person in a direct message, but only where that person
 * may see the record the message names, and with money hidden by what they may see. Safe to repeat per message (one notification
 * per person per message). Never decides anything.
 */
export async function deliverChatNotifications(organizationId: string, messageId: string): Promise<{ notified: number }> {
  const loaded = await withOrgContext(organizationId, async (tx) => {
    const message = await tx.chatMessage.findFirst({ where: { id: messageId, organizationId } });
    if (!message || message.deletedAt || message.erasedAt) return null;
    const channel = await tx.chatChannel.findFirst({ where: { id: message.channelId, organizationId } });
    if (!channel) return null;
    const mentions = (await tx.chatMessageMention.findMany({ where: { organizationId, messageId }, select: { membershipId: true } })).map((m) => m.membershipId);
    const dm = channel.kind === "DIRECT" ? (await tx.chatChannelMember.findMany({ where: { organizationId, channelId: channel.id, membershipId: { not: message.authorMembershipId ?? "" } }, select: { membershipId: true } })).map((m) => m.membershipId) : [];
    const names = await namesOf(tx, organizationId, [message.authorMembershipId]);
    return { message, channel, mentions, dm, author: names.get(message.authorMembershipId ?? "") ?? "A colleague" };
  });
  if (!loaded) return { notified: 0 };
  const { message, channel, mentions, dm, author } = loaded;
  const { slug } = await adminDb.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { slug: true } });
  const recipients = new Map<string, "mention" | "direct">();
  for (const id of dm) recipients.set(id, "direct");
  for (const id of mentions) recipients.set(id, "mention");
  recipients.delete(message.authorMembershipId ?? "");
  let notified = 0;
  for (const [membershipId, kind] of recipients) {
    const member = await contextOfMember(organizationId, membershipId);
    if (!member || !hasPermission(member, "chat.view")) continue;
    // The recipient must be able to read the channel, and open every record the message names.
    const allowed = await withOrgContext(organizationId, async (tx) => {
      const isMember = await tx.chatChannelMember.findFirst({ where: { channelId: channel.id, membershipId }, select: { id: true } });
      if (!isMember && !(channel.kind === "PUBLIC" && !isLimitedMember(member))) return false;
      const refs: Ref[] = [];
      if (channel.kind === "RECORD") refs.push({ type: channel.recordType as RecordType, id: channel.recordId! });
      if (message.cardType) refs.push({ type: message.cardType as CardType, id: message.cardId! });
      if (refs.length === 0) return true;
      const records = await loadRecords(tx, member, refs);
      return refs.every((r) => records.get(refKey(r))?.openable);
    });
    if (!allowed) continue;
    // A retried job must not notify twice: one notification per person per message.
    const already = await adminDb.notification.findFirst({ where: { organizationId, membershipId, entityType: "ChatMessage", entityId: message.id }, select: { id: true } });
    if (already) continue;
    const where = channel.kind === "DIRECT" ? "a direct message" : `#${channel.name}`;
    await notifyEvent({
      organizationId,
      membershipId,
      type: "MENTION",
      title: kind === "mention" ? `${author} mentioned you in ${where}` : `${author} sent you a message`,
      body: textForViewer(member, snippet(message.body || "Sent a record or a file")),
      entityType: "ChatMessage",
      entityId: message.id,
      path: `/o/${slug}/chat?channel=${channel.id}`,
    });
    notified += 1;
  }
  return { notified };
}

export async function deleteMessage(ctx: AuthContext, channelId: string, messageId: string) {
  await gateChat(ctx);
  const meta = await withOrgContext(ctx.organizationId, async (tx) => {
    const access = await readable(ctx, tx, channelId);
    const message = await tx.chatMessage.findFirst({ where: { id: messageId, channelId, organizationId: ctx.organizationId } });
    if (!message) throw new NotFoundError("Message", messageId);
    if (message.deletedAt) return null;
    if (message.authorMembershipId !== ctx.membershipId) {
      if (!hasPermission(ctx, "chat.channels.manage")) throw new ForbiddenError("chat.channels.manage", { roleKey: ctx.roleKey, organizationId: ctx.organizationId, permissionKeys: ["chat.channels.manage"] });
    } else {
      requirePermission(ctx, "chat.post");
    }
    // The text goes with the message; the row stays so the numbers and the thread keep their shape.
    await tx.chatMessage.update({ where: { id: messageId }, data: { body: "", cardType: null, cardId: null, deletedAt: new Date(), deletedByMembershipId: ctx.membershipId, updatedAt: new Date() } });
    await tx.chatMessageMention.deleteMany({ where: { messageId } });
    const fileIds = (await tx.chatMessageAttachment.findMany({ where: { organizationId: ctx.organizationId, messageId }, select: { fileId: true } })).map((a) => a.fileId);
    await tx.chatMessageAttachment.deleteMany({ where: { messageId } });
    await tx.chatReaction.deleteMany({ where: { messageId } });
    return { channelId, seq: message.seq, own: message.authorMembershipId === ctx.membershipId, kind: access.channel.kind, fileIds };
  });
  if (meta) {
    await deleteChatFiles(ctx.organizationId, meta.fileIds);
    const { fileIds: _files, ...auditMeta } = meta;
    void _files;
    await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "chat.message_deleted", entityType: "ChatMessage", entityId: messageId, metadata: auditMeta });
  }
  return { ok: true };
}

export async function setReaction(ctx: AuthContext, channelId: string, messageId: string, emoji: string, on: boolean) {
  await gateChat(ctx, "chat.post");
  const clean = typeof emoji === "string" ? emoji.trim() : "";
  if (clean.length < 1 || clean.length > 16 || /[\s<>]/.test(clean)) throw new ValidationError("Pick an emoji.", [{ path: "emoji", message: "Invalid emoji." }]);
  return withOrgContext(ctx.organizationId, async (tx) => {
    const access = await postable(ctx, tx, channelId);
    const message = await tx.chatMessage.findFirst({ where: { id: messageId, channelId, organizationId: ctx.organizationId } });
    if (!message || message.deletedAt || message.erasedAt) throw new NotFoundError("Message", messageId);
    if (on) {
      await tx.chatReaction.createMany({ data: [{ organizationId: ctx.organizationId, messageId, membershipId: ctx.membershipId, emoji: clean }], skipDuplicates: true });
    } else {
      await tx.chatReaction.deleteMany({ where: { messageId, membershipId: ctx.membershipId, emoji: clean } });
    }
    const updated = await tx.chatMessage.update({ where: { id: messageId }, data: { updatedAt: new Date() } });
    const [view] = await presentMessages(ctx, tx, [updated], recordOf(access.channel));
    return view!;
  });
}

/** Marks a channel read up to a message number (default: the latest). The marker only moves forward. */
export async function markRead(ctx: AuthContext, channelId: string, upToSeq?: number) {
  await gateChat(ctx);
  return withOrgContext(ctx.organizationId, async (tx) => {
    const access = await readable(ctx, tx, channelId);
    if (!access.member) throw new ValidationError("Join the channel first.", [{ path: "channelId", message: "You are not a member of this channel." }]);
    const target = Math.min(Math.max(Math.floor(upToSeq ?? access.channel.lastSeq), 0), access.channel.lastSeq);
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO chat_read_markers (id, organization_id, channel_id, membership_id, last_read_seq, updated_at)
      VALUES (gen_random_uuid()::text, ${ctx.organizationId}, ${channelId}, ${ctx.membershipId}, ${target}, now())
      ON CONFLICT (channel_id, membership_id) DO UPDATE SET last_read_seq = GREATEST(chat_read_markers.last_read_seq, EXCLUDED.last_read_seq), updated_at = now()`);
    const counts = await unreadCounts(tx, ctx.organizationId, ctx.membershipId, [channelId]);
    const c = counts.get(channelId) ?? { unread: 0, mentions: 0 };
    return { channelId, lastSeq: access.channel.lastSeq, unread: c.unread, mentions: c.mentions };
  });
}

/** A signed download link for a file attached to a message, for anyone who can read the channel. */
export async function getMessageAttachmentLink(ctx: AuthContext, channelId: string, messageId: string, fileId: string) {
  await gateChat(ctx);
  const file = await withOrgContext(ctx.organizationId, async (tx) => {
    await readable(ctx, tx, channelId);
    const message = await tx.chatMessage.findFirst({ where: { id: messageId, channelId, organizationId: ctx.organizationId, deletedAt: null, erasedAt: null }, select: { id: true } });
    const attached = message ? await tx.chatMessageAttachment.findFirst({ where: { organizationId: ctx.organizationId, messageId, fileId }, select: { id: true } }) : null;
    if (!attached) throw new NotFoundError("File", fileId);
    return tx.file.findFirst({ where: { id: fileId, organizationId: ctx.organizationId } });
  });
  if (!file || file.status !== "READY") throw new NotFoundError("File", fileId);
  const { issueDownloadLinkAuthorised } = await import("./fileService");
  return issueDownloadLinkAuthorised(file);
}

// ---------------------------------------------------------------------------
// Search (B2.12 integration, FIG-1384)
// ---------------------------------------------------------------------------

/**
 * Messages the caller may read, matching the text. Only channels the person can read are searched (membership, public channels for
 * people who are not limited, record channels whose record they can open); deleted and erased messages are never found; money in
 * the text is hidden by what the viewer may see, as everywhere else.
 */
export async function searchMessages(ctx: AuthContext, query: string, request: PageRequest = {}) {
  await gateChat(ctx);
  const q = query.trim();
  const paging = resolvePaging(request);
  type Hit = MessageView & { channelName: string | null };
  if (q.length < 2) return { ...buildPage<Hit>([], 0, paging), tooShort: true };
  return withOrgContext(ctx.organizationId, async (tx) => {
    const channels = await listChannelsIn(ctx, tx, { includeArchived: true });
    // A record channel the person has not joined is listed (they could join) but its messages stay closed until they do.
    const readableIds = channels.filter((c) => c.joined || c.kind === "PUBLIC").map((c) => c.id);
    if (readableIds.length === 0) return { ...buildPage<Hit>([], 0, paging), tooShort: false };
    const where: Prisma.ChatMessageWhereInput = { organizationId: ctx.organizationId, channelId: { in: readableIds }, deletedAt: null, erasedAt: null, body: { contains: q, mode: "insensitive" } };
    const candidates = await tx.chatMessage.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: SEARCH_CANDIDATES });
    const byId = new Map(channels.map((c) => [c.id, c]));
    const perChannel = new Map<string, MessageRow[]>();
    for (const r of candidates) perChannel.set(r.channelId, [...(perChannel.get(r.channelId) ?? []), r]);
    const views = new Map<string, MessageView>();
    for (const [channelId, list] of perChannel) {
      for (const v of await presentMessages(ctx, tx, list, byId.get(channelId)!.record)) views.set(v.id, v);
    }
    // Match on what the viewer sees: a figure hidden from them cannot be found by searching for it.
    const needle = q.toLowerCase();
    const hits: Hit[] = [];
    for (const r of candidates) {
      const v = views.get(r.id)!;
      if (v.body !== null && v.body.toLowerCase().includes(needle)) hits.push({ ...v, channelName: byId.get(r.channelId)?.name ?? null });
    }
    return { ...buildPage(hits.slice(paging.skip, paging.skip + paging.take), hits.length, paging), tooShort: false };
  });
}

const SEARCH_CANDIDATES = 500;
