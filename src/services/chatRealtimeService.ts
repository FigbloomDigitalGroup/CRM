import type { AuthContext } from "../auth/context";
import { NotFoundError } from "../auth/errors";
import { withOrgContext } from "../db/orgScopedClient";
import { resolveActiveMembership } from "../repositories/memberships";
import { gateChat, openableRecordKeys, presentMessages, PRESENCE_TTL_MS, unreadCounts, type MessageView, type RecordType } from "./chatService";

/**
 * Chat delivery (FIG-1383, B6.25). The transport is polling with a cursor, with an optional long poll (docs/COMMUNICATION.md):
 *
 *   - One call, `syncChat`, answers everything the screen needs: the unread count of every channel the person is in, the messages that
 *     arrived after the numbers the client already holds, messages that changed since a moment (deleted, reacted to), who is online and
 *     who is typing. It works on any host (Vercel functions, a plain Node server) with no connection to keep open.
 *   - Messages are numbered per channel without gaps, and the client sends the highest number it holds per channel (`known`). The server
 *     returns exactly the messages above it, so after a reconnect or a sleeping phone no message is missed, and none is returned twice.
 *     The client keeps messages by id, so the small overlap on `since` can never show a message twice.
 *   - Every call recomputes membership from the database and re-checks the record behind a record channel, so a removed member stops
 *     receiving at their next call (and within one second of a long poll). Nothing is pushed to a connection that was opened earlier.
 *   - Presence is a heartbeat: a person is online when their last call was under a minute ago. Typing lasts six seconds.
 *   - A long poll (`waitSeconds`, at most 20) holds the request and answers as soon as something changed for this person.
 *   - Mentions and direct messages also go out as notifications and push, by the `chat.notify` job (chatService.deliverChatNotifications).
 *
 * WebSocket or server-sent events can replace the polling later without changing the data: the events are the same rows.
 */

export const MAX_WAIT_SECONDS = 20;
export const TYPING_SECONDS = 6;
const POLL_EVERY_MS = 1000;
const CATCH_UP_LIMIT = 200;
const PER_CHANNEL_LIMIT = 100;
const UPDATED_LIMIT = 100;
/** The window `since` is widened by, so a change committed just after the previous answer was cut is still found. Harmless to repeat. */
const OVERLAP_MS = 5000;

export interface SyncInput {
  /** Channel id -> the highest message number the client holds. A channel not listed returns state only (no messages). */
  known?: Record<string, number>;
  /** The `serverTime` of the previous answer: messages deleted or reacted to since then are returned again. */
  since?: Date;
  /** Hold the request until something changes (at most 20 seconds). */
  waitSeconds?: number;
}

export interface ChannelState {
  channelId: string;
  lastSeq: number;
  unread: number;
  mentions: number;
  archived: boolean;
  typing: { membershipId: string; name: string }[];
}

export interface SyncResult {
  serverTime: Date;
  /** Every channel the person is in. A channel that is missing here is one they no longer receive (left, removed, record closed). */
  channels: ChannelState[];
  /** Messages above the client's numbers, oldest first per channel, at most 200 in all. `more` says to call again. */
  messages: MessageView[];
  more: boolean;
  /** Messages the client already holds that changed (deleted, reacted to, erased). */
  updated: MessageView[];
  online: { membershipId: string; status: "ONLINE" | "AWAY" }[];
  unreadTotal: number;
  mentionTotal: number;
}

interface Snapshot {
  result: SyncResult;
  /** A cheap signature of what the person would see: the long poll answers when it changes. */
  signature: string;
}

async function snapshot(ctx: AuthContext, input: SyncInput, now: Date): Promise<Snapshot> {
  return withOrgContext(ctx.organizationId, async (tx) => {
    const org = ctx.organizationId;
    // The channels this person is in right now, minus record channels whose record they can no longer open.
    const mine = await tx.chatChannelMember.findMany({ where: { organizationId: org, membershipId: ctx.membershipId }, select: { channelId: true } });
    const channels = mine.length ? await tx.chatChannel.findMany({ where: { organizationId: org, id: { in: mine.map((m) => m.channelId) } } }) : [];
    const records = await openableRecordKeys(tx, ctx, channels.filter((c) => c.kind === "RECORD").map((c) => ({ type: c.recordType as RecordType, id: c.recordId! })));
    const live = channels.filter((c) => c.kind !== "RECORD" || records.has(`${c.recordType}:${c.recordId}`));
    const ids = live.map((c) => c.id);

    const unread = ids.length ? await unreadCounts(tx, org, ctx.membershipId, ids) : new Map<string, { unread: number; mentions: number }>();

    // Typing and presence (people in the same channels only for typing; everyone in the organisation for presence).
    const cutoff = new Date(now.getTime() - PRESENCE_TTL_MS);
    const presence = await tx.chatPresence.findMany({ where: { organizationId: org, OR: [{ lastSeenAt: { gt: cutoff } }, { typingUntil: { gt: now } }] } });
    const typingNames = presence.filter((p) => p.typingChannelId && p.typingUntil && p.typingUntil > now && p.membershipId !== ctx.membershipId && ids.includes(p.typingChannelId));
    const people = typingNames.length
      ? await tx.membership.findMany({ where: { organizationId: org, id: { in: typingNames.map((p) => p.membershipId) } }, select: { id: true, user: { select: { name: true } } } })
      : [];
    const nameOf = new Map(people.map((p) => [p.id, p.user.name]));

    const states: ChannelState[] = live.map((c) => ({
      channelId: c.id,
      lastSeq: c.lastSeq,
      unread: unread.get(c.id)?.unread ?? 0,
      mentions: unread.get(c.id)?.mentions ?? 0,
      archived: c.archivedAt !== null,
      typing: typingNames.filter((p) => p.typingChannelId === c.id).map((p) => ({ membershipId: p.membershipId, name: nameOf.get(p.membershipId) ?? "" })),
    }));

    // New messages above what the client holds.
    const known = input.known ?? {};
    const wanted = live.filter((c) => known[c.id] !== undefined && c.lastSeq > known[c.id]!);
    let rows = wanted.length
      ? await tx.chatMessage.findMany({
          where: { organizationId: org, OR: wanted.map((c) => ({ channelId: c.id, seq: { gt: known[c.id]! } })) },
          orderBy: [{ channelId: "asc" }, { seq: "asc" }],
        })
      : [];
    // At most PER_CHANNEL_LIMIT per channel and CATCH_UP_LIMIT in all; the client calls again while `more` is true, from the new numbers.
    const taken = new Map<string, number>();
    rows = rows.filter((r) => {
      const n = (taken.get(r.channelId) ?? 0) + 1;
      taken.set(r.channelId, n);
      return n <= PER_CHANNEL_LIMIT;
    });
    const more = rows.length > CATCH_UP_LIMIT || wanted.some((c) => known[c.id]! + PER_CHANNEL_LIMIT < c.lastSeq);
    rows = rows.slice(0, CATCH_UP_LIMIT);

    // Messages the client holds that changed since the last answer (with a small overlap).
    const since = input.since ? new Date(input.since.getTime() - OVERLAP_MS) : null;
    const knownIds = live.filter((c) => known[c.id] !== undefined);
    const changed =
      since && knownIds.length
        ? await tx.chatMessage.findMany({
            where: { organizationId: org, OR: knownIds.map((c) => ({ channelId: c.id, seq: { lte: known[c.id]! } })), updatedAt: { gt: since } },
            orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
            take: UPDATED_LIMIT,
          })
        : [];

    const byChannel = new Map(live.map((c) => [c.id, c]));
    const present = async (list: typeof rows): Promise<MessageView[]> => {
      const grouped = new Map<string, typeof rows>();
      for (const r of list) grouped.set(r.channelId, [...(grouped.get(r.channelId) ?? []), r]);
      const views = new Map<string, MessageView>();
      for (const [channelId, group] of grouped) {
        const c = byChannel.get(channelId)!;
        for (const v of await presentMessages(ctx, tx, group, c.kind === "RECORD" ? { type: c.recordType as RecordType, id: c.recordId! } : null)) views.set(v.id, v);
      }
      return list.map((r) => views.get(r.id)!);
    };
    const messages = await present(rows);
    const updated = await present(changed);

    const online = presence.filter((p) => p.lastSeenAt > cutoff).map((p) => ({ membershipId: p.membershipId, status: p.status as "ONLINE" | "AWAY" }));
    const unreadTotal = states.reduce((n, s) => n + s.unread, 0);
    const mentionTotal = states.reduce((n, s) => n + s.mentions, 0);
    const signature = JSON.stringify([states.map((s) => [s.channelId, s.lastSeq, s.unread, s.typing.length]), updated.length, online.length]);
    return { result: { serverTime: now, channels: states, messages, more, updated, online, unreadTotal, mentionTotal }, signature };
  });
}

/** Records the heartbeat: online, with the status the client reports. At most one write per call, skipped when it was written moments ago. */
export async function touchPresence(ctx: AuthContext, status: "ONLINE" | "AWAY" = "ONLINE", now = new Date()) {
  await withOrgContext(ctx.organizationId, async (tx) => {
    const current = await tx.chatPresence.findFirst({ where: { organizationId: ctx.organizationId, membershipId: ctx.membershipId } });
    if (current && current.status === status && now.getTime() - current.lastSeenAt.getTime() < 15_000) return;
    await tx.chatPresence.upsert({
      where: { organizationId_membershipId: { organizationId: ctx.organizationId, membershipId: ctx.membershipId } },
      create: { organizationId: ctx.organizationId, membershipId: ctx.membershipId, status, lastSeenAt: now },
      update: { status, lastSeenAt: now },
    });
  });
}

export async function heartbeat(ctx: AuthContext, status: "ONLINE" | "AWAY" = "ONLINE") {
  await gateChat(ctx);
  await touchPresence(ctx, status);
  return { ok: true, status, expiresInSeconds: PRESENCE_TTL_MS / 1000 };
}

/** "Is typing" in a channel the person can post in; it lapses on its own after six seconds. */
export async function setTyping(ctx: AuthContext, channelId: string, now = new Date()) {
  await gateChat(ctx, "chat.post");
  await withOrgContext(ctx.organizationId, async (tx) => {
    const member = await tx.chatChannelMember.findFirst({ where: { organizationId: ctx.organizationId, channelId, membershipId: ctx.membershipId }, select: { id: true } });
    if (!member) throw new NotFoundError("Channel", channelId);
    await tx.chatPresence.upsert({
      where: { organizationId_membershipId: { organizationId: ctx.organizationId, membershipId: ctx.membershipId } },
      create: { organizationId: ctx.organizationId, membershipId: ctx.membershipId, status: "ONLINE", lastSeenAt: now, typingChannelId: channelId, typingUntil: new Date(now.getTime() + TYPING_SECONDS * 1000) },
      update: { lastSeenAt: now, typingChannelId: channelId, typingUntil: new Date(now.getTime() + TYPING_SECONDS * 1000) },
    });
  });
  return { ok: true };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The one call a chat screen polls. With `waitSeconds` it holds until something the person would see has changed (new messages, a
 * count, typing, a change to a message they hold) or the time is up, re-checking their membership on every beat.
 */
export async function syncChat(ctx: AuthContext, input: SyncInput = {}): Promise<SyncResult> {
  await gateChat(ctx);
  await touchPresence(ctx);
  const wait = Math.min(Math.max(Math.floor(input.waitSeconds ?? 0), 0), MAX_WAIT_SECONDS);
  const deadline = Date.now() + wait * 1000;
  let current = await snapshot(ctx, input, new Date());
  const hasNews = (s: Snapshot) => s.result.messages.length > 0 || s.result.updated.length > 0 || s.result.channels.some((c) => c.typing.length > 0);
  const baseline = current.signature;
  let live: AuthContext = ctx;
  while (wait > 0 && !hasNews(current) && current.signature === baseline && Date.now() + POLL_EVERY_MS < deadline) {
    await sleep(POLL_EVERY_MS);
    // A person who was deactivated or lost chat access while waiting gets nothing more.
    const fresh = await resolveActiveMembership(ctx.userId, ctx.organizationId);
    if (!fresh || !fresh.permissionKeys.includes("chat.view")) throw new NotFoundError("Channel", "sync");
    live = fresh;
    current = await snapshot(live, input, new Date());
  }
  return current.result;
}
