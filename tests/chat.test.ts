/**
 * Chat (FIG-1382 B6.24, FIG-1383 B6.25, FIG-1384 B6.26): data model, API behaviour, delivery, permissions and masking.
 * The chat tables are tenant tables: the cross-organisation tests below try every service call with the other organisation's ids.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import type { AuthContext } from "../src/auth/context";
import { adminDb } from "../src/db/adminClient";
import { dbCallStats, withOrgContext } from "../src/db/orgScopedClient";
import { withIdempotency } from "../src/lib/idempotency";
import { PERMISSION_MIN_RELEASE, ROLE_PERMISSIONS } from "../prisma/seedData";
import { createCompany } from "../src/services/companyService";
import { createDeal } from "../src/services/dealService";
import {
  addMembers,
  createChannel,
  deleteChannel,
  deleteMessage,
  deliverChatNotifications,
  getChannel,
  getUnreadTotals,
  joinChannel,
  listChannels,
  listMembers,
  listMessages,
  markRead,
  postMessage,
  removeMember,
  searchMessages,
  setReaction,
  updateChannel,
  cleanMessageBody,
} from "../src/services/chatService";
import { heartbeat, setTyping, syncChat } from "../src/services/chatRealtimeService";
import { TOGGLES_KEY } from "../src/lib/featureConfig";
import { listOrganizationAuditLog } from "../src/services/auditLogService";
import { searchAll } from "../src/services/searchService";
import { seedDemoChat } from "../prisma/devSeedChat";
import { createTestContext, createTestOrganization, getPipelineStageId } from "./helpers/fixtures";

const ORIGINAL_RELEASE = process.env.ACTIVE_RELEASE;
beforeAll(() => {
  process.env.ACTIVE_RELEASE = "v1.1";
});
afterAll(() => {
  if (ORIGINAL_RELEASE === undefined) delete process.env.ACTIVE_RELEASE;
  else process.env.ACTIVE_RELEASE = ORIGINAL_RELEASE;
});

interface World {
  org: { id: string; slug: string };
  management: AuthContext;
  sales: AuthContext;
  salesB: AuthContext;
  delivery: AuthContext;
  finance: AuthContext;
  technical: AuthContext;
}

async function world(prefix = "Chat"): Promise<World> {
  const org = await createTestOrganization(prefix);
  return {
    org,
    management: await createTestContext(org.id, "MANAGEMENT", "m"),
    sales: await createTestContext(org.id, "SALES", "s1"),
    salesB: await createTestContext(org.id, "SALES", "s2"),
    delivery: await createTestContext(org.id, "DELIVERY", "d"),
    finance: await createTestContext(org.id, "FINANCE", "f"),
    technical: await createTestContext(org.id, "RESTRICTED_TECHNICAL", "t"),
  };
}

async function dealFor(w: World, owner: AuthContext, value = 480000, { won = false } = {}) {
  const company = (await createCompany(w.management, { name: `Kisumu Greens ${Math.random().toString(36).slice(2, 6)}`, ownerMembershipId: owner.membershipId } as never)).company;
  const deal = await createDeal(w.management, { companyId: company.id, pipelineStageId: await getPipelineStageId(w.org.id, "SOLUTION_PRESENTED"), ownerMembershipId: owner.membershipId, value } as never);
  if (won) await adminDb.deal.update({ where: { id: deal.id }, data: { outcome: "WON", wonAt: new Date() } });
  return deal;
}

async function rejects(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e;
  }
  return null;
}

describe("B6.24 permissions: the new keys, every role", () => {
  const KEYS = ["chat.view", "chat.post", "chat.channels.manage", "mail.use", "meetings.schedule"];
  const EXPECTED: Record<string, string[]> = {
    MANAGEMENT: KEYS,
    SALES: ["chat.view", "chat.post", "mail.use", "meetings.schedule"],
    DELIVERY: ["chat.view", "chat.post", "mail.use", "meetings.schedule"],
    FINANCE: ["chat.view", "chat.post"],
    RESTRICTED_TECHNICAL: ["chat.view", "chat.post"],
  };

  it("gives each role exactly the keys the decision says, and the keys wait for V1.1", () => {
    for (const [role, keys] of Object.entries(EXPECTED)) {
      expect(ROLE_PERMISSIONS[role]!.filter((k) => KEYS.includes(k)).sort(), role).toEqual([...keys].sort());
    }
    for (const key of KEYS) expect(PERMISSION_MIN_RELEASE[key], key).toBe("v1.1");
  });

  it("carries the keys on a V1.1 request and strips them on a V1 request", async () => {
    const w = await world("ChatKeys");
    for (const [ctxName, role] of [["management", "MANAGEMENT"], ["sales", "SALES"], ["delivery", "DELIVERY"], ["finance", "FINANCE"], ["technical", "RESTRICTED_TECHNICAL"]] as const) {
      const ctx = w[ctxName];
      expect(KEYS.filter((k) => ctx.permissionKeys.includes(k)).sort(), role).toEqual([...EXPECTED[role]!].sort());
    }
    process.env.ACTIVE_RELEASE = "v1";
    try {
      const v1 = await createTestContext(w.org.id, "SALES", "v1");
      expect(KEYS.filter((k) => v1.permissionKeys.includes(k))).toEqual([]);
      expect(await rejects(listChannels(v1))).toBeInstanceOf(Error);
    } finally {
      process.env.ACTIVE_RELEASE = "v1.1";
    }
  });

  it("refuses chat to a person without the key, and the Communication toggle switches the whole area off", async () => {
    const w = await world("ChatToggle");
    const noKeys = { ...w.sales, permissionKeys: w.sales.permissionKeys.filter((k) => !k.startsWith("chat.")) };
    expect(await rejects(listChannels(noKeys))).toBeInstanceOf(ForbiddenError);
    const readOnly = { ...w.sales, permissionKeys: w.sales.permissionKeys.filter((k) => k !== "chat.post") };
    expect((await listChannels(readOnly)).items).toEqual([]);
    expect(await rejects(createChannel(readOnly, { kind: "PUBLIC", name: "nope" }))).toBeInstanceOf(ForbiddenError);

    await adminDb.organizationSetting.upsert({
      where: { organizationId_key: { organizationId: w.org.id, key: TOGGLES_KEY } },
      create: { organizationId: w.org.id, key: TOGGLES_KEY, value: { "communication.group": false } },
      update: { value: { "communication.group": false } },
    });
    const err = await rejects(listChannels(w.management));
    expect((err as Error).name).toBe("FeatureUnavailableError");
  });
});

describe("B6.24 channels, members, messages", () => {
  it("creates, renames, archives and deletes a channel, with an audit entry for each", async () => {
    const w = await world("ChatLife");
    const channel = await createChannel(w.management, { kind: "PUBLIC", name: "general", description: "Company-wide" });
    expect(channel).toMatchObject({ kind: "PUBLIC", name: "general", joined: true, role: "OWNER", memberCount: 1, private: false });
    // A second channel of the same name (any case) is refused.
    expect(await rejects(createChannel(w.sales, { kind: "PUBLIC", name: "GENERAL" }))).toMatchObject({ status: 409 });
    // Only an owner or a manager renames; a plain member does not.
    await joinChannel(w.sales, channel.id);
    expect(await rejects(updateChannel(w.sales, channel.id, { name: "mine" }))).toBeInstanceOf(ForbiddenError);
    const renamed = await updateChannel(w.management, channel.id, { name: "company", description: null });
    expect(renamed.name).toBe("company");
    // Delete needs the channel archived first.
    expect(await rejects(deleteChannel(w.management, channel.id))).toBeInstanceOf(ValidationError);
    const archived = await updateChannel(w.management, channel.id, { archived: true });
    expect(archived.archived).toBe(true);
    expect(await rejects(postMessage(w.management, channel.id, { body: "late" }))).toMatchObject({ status: 409 });
    expect((await listChannels(w.management)).items.find((c) => c.id === channel.id)).toBeUndefined();
    expect((await listChannels(w.management, { includeArchived: true })).items.find((c) => c.id === channel.id)).toBeTruthy();
    await updateChannel(w.management, channel.id, { archived: false });
    await postMessage(w.management, channel.id, { body: "back" });
    await updateChannel(w.management, channel.id, { archived: true });
    await deleteChannel(w.management, channel.id);
    expect(await adminDb.chatChannel.count({ where: { id: channel.id } })).toBe(0);
    expect(await adminDb.chatMessage.count({ where: { channelId: channel.id } })).toBe(0);
    const actions = (await adminDb.auditEvent.findMany({ where: { organizationId: w.org.id, entityId: channel.id }, orderBy: { createdAt: "asc" } })).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["chat.channel_created", "chat.member_joined", "chat.channel_renamed", "chat.channel_archived", "chat.channel_restored", "chat.channel_deleted"]));
  });

  it("keeps a private channel invisible to non-members, Management included, until they are added", async () => {
    const w = await world("ChatPrivate");
    const secret = await createChannel(w.sales, { kind: "PRIVATE", name: "sales-secret", memberIds: [w.salesB.membershipId] });
    await postMessage(w.sales, secret.id, { body: "pricing plan" });
    for (const outsider of [w.management, w.delivery, w.finance]) {
      expect((await listChannels(outsider)).items.map((c) => c.id)).not.toContain(secret.id);
      expect(await rejects(getChannel(outsider, secret.id))).toBeInstanceOf(NotFoundError);
      expect(await rejects(listMessages(outsider, secret.id))).toBeInstanceOf(NotFoundError);
      expect(await rejects(joinChannel(outsider, secret.id))).toBeInstanceOf(NotFoundError);
      expect(await rejects(postMessage(outsider, secret.id, { body: "hi" }))).toBeInstanceOf(NotFoundError);
      expect(await rejects(listMembers(outsider, secret.id))).toBeInstanceOf(NotFoundError);
    }
    // Search never finds it for an outsider.
    expect((await searchMessages(w.management, "pricing")).items).toEqual([]);
    expect((await searchMessages(w.salesB, "pricing")).items).toHaveLength(1);
    // Adding Management makes it theirs.
    await addMembers(w.sales, secret.id, [w.management.membershipId]);
    expect((await listMessages(w.management, secret.id)).items).toHaveLength(1);
    // A plain member cannot add people; the owner can.
    expect(await rejects(addMembers(w.salesB, secret.id, [w.finance.membershipId]))).toBeInstanceOf(ForbiddenError);
  });

  it("shows a limited member (Restricted Technical) only the channels they were added to", async () => {
    const w = await world("ChatLimited");
    const general = await createChannel(w.management, { kind: "PUBLIC", name: "general" });
    const fieldOps = await createChannel(w.management, { kind: "PUBLIC", name: "field-ops", memberIds: [w.technical.membershipId] });
    const seen = (await listChannels(w.technical)).items.map((c) => c.name);
    expect(seen).toEqual(["field-ops"]);
    expect(await rejects(listMessages(w.technical, general.id))).toBeInstanceOf(NotFoundError);
    expect(await rejects(joinChannel(w.technical, general.id))).toBeInstanceOf(NotFoundError);
    expect(fieldOps.memberCount).toBe(2);
    // Non-limited people see public channels they have not joined, and can read them before joining.
    expect((await listChannels(w.delivery)).items.map((c) => c.name).sort()).toEqual(["field-ops", "general"]);
    expect((await listMessages(w.delivery, general.id)).items).toEqual([]);
    expect(await rejects(postMessage(w.delivery, general.id, { body: "hi" }))).toBeInstanceOf(ValidationError);
  });

  it("opens exactly one direct message per pair, and only the two can see it", async () => {
    const w = await world("ChatDm");
    const a = await createChannel(w.sales, { kind: "DIRECT", memberIds: [w.delivery.membershipId] });
    const b = await createChannel(w.delivery, { kind: "DIRECT", memberIds: [w.sales.membershipId] });
    expect(b.id).toBe(a.id);
    expect(b.created).toBe(false);
    expect(a.partner?.membershipId).toBe(w.delivery.membershipId);
    expect(await rejects(createChannel(w.sales, { kind: "DIRECT", memberIds: [w.sales.membershipId] }))).toBeInstanceOf(ValidationError);
    expect(await rejects(createChannel(w.sales, { kind: "DIRECT", memberIds: [w.finance.membershipId, w.delivery.membershipId] }))).toBeInstanceOf(ValidationError);
    expect(await rejects(getChannel(w.management, a.id))).toBeInstanceOf(NotFoundError);
    expect(await rejects(addMembers(w.sales, a.id, [w.finance.membershipId]))).toBeInstanceOf(ValidationError);
    expect(await rejects(removeMember(w.sales, a.id, w.sales.membershipId))).toBeInstanceOf(ValidationError);
  });

  it("numbers messages without gaps, even when many are posted at once, and pages by number", async () => {
    const w = await world("ChatSeq");
    const ch = await createChannel(w.management, { kind: "PUBLIC", name: "busy", memberIds: [w.sales.membershipId, w.delivery.membershipId] });
    await Promise.all(Array.from({ length: 12 }, (_, i) => postMessage([w.management, w.sales, w.delivery][i % 3]!, ch.id, { body: `m${i}` })));
    const all = await listMessages(w.management, ch.id, { limit: 100 });
    expect(all.items.map((m) => m.seq)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(all.lastSeq).toBe(12);
    const older = await listMessages(w.management, ch.id, { before: 6, limit: 3 });
    expect(older.items.map((m) => m.seq)).toEqual([3, 4, 5]);
    expect(older.hasMore).toBe(true);
    const newer = await listMessages(w.management, ch.id, { after: 10 });
    expect(newer.items.map((m) => m.seq)).toEqual([11, 12]);
    expect(newer.hasMore).toBe(false);
  });

  it("validates and cleans message text", async () => {
    expect(cleanMessageBody("  <b>Hello</b>\r\n\r\n\r\n\r\nthere\u0007 ")).toBe("Hello\n\nthere");
    expect(() => cleanMessageBody("   ")).toThrow(ValidationError);
    expect(() => cleanMessageBody("x".repeat(4001))).toThrow(ValidationError);
    const w = await world("ChatText");
    const ch = await createChannel(w.management, { kind: "PUBLIC", name: "text" });
    expect(await rejects(postMessage(w.management, ch.id, { body: "" }))).toBeInstanceOf(ValidationError);
    expect(await rejects(postMessage(w.management, ch.id, { body: "x", fileIds: ["nope"] }))).toBeInstanceOf(ValidationError);
    expect(await rejects(postMessage(w.management, ch.id, { body: "x", mentions: ["not-a-member"] }))).toBeInstanceOf(ValidationError);
  });

  it("deletes a message by its author or a manager, removes the text, and keeps the place in the thread", async () => {
    const w = await world("ChatDelete");
    const ch = await createChannel(w.management, { kind: "PUBLIC", name: "del", memberIds: [w.sales.membershipId, w.delivery.membershipId] });
    const mine = await postMessage(w.sales, ch.id, { body: "oops secret" });
    const other = await postMessage(w.delivery, ch.id, { body: "keep" });
    expect(await rejects(deleteMessage(w.delivery, ch.id, mine.id))).toBeInstanceOf(ForbiddenError);
    await deleteMessage(w.sales, ch.id, mine.id);
    await deleteMessage(w.management, ch.id, other.id);
    const rows = await adminDb.chatMessage.findMany({ where: { channelId: ch.id }, orderBy: { seq: "asc" } });
    expect(rows.map((r) => [r.seq, r.body, r.deletedAt !== null])).toEqual([[1, "", true], [2, "", true]]);
    const view = (await listMessages(w.management, ch.id)).items;
    expect(view.map((m) => [m.seq, m.body, m.deleted])).toEqual([[1, null, true], [2, null, true]]);
    const audit = await adminDb.auditEvent.findMany({ where: { organizationId: w.org.id, action: "chat.message_deleted" } });
    expect(audit).toHaveLength(2);
    expect(JSON.stringify(audit)).not.toContain("oops secret");
  });

  it("reacts, un-reacts, and counts once per person and emoji", async () => {
    const w = await world("ChatReact");
    const ch = await createChannel(w.management, { kind: "PUBLIC", name: "react", memberIds: [w.sales.membershipId] });
    const m = await postMessage(w.management, ch.id, { body: "ship it" });
    await setReaction(w.sales, ch.id, m.id, "👍", true);
    await setReaction(w.sales, ch.id, m.id, "👍", true);
    const after = await setReaction(w.management, ch.id, m.id, "👍", true);
    expect(after.reactions).toEqual([{ emoji: "👍", count: 2, mine: true }]);
    const removed = await setReaction(w.sales, ch.id, m.id, "👍", false);
    expect(removed.reactions).toEqual([{ emoji: "👍", count: 1, mine: false }]);
    expect(await rejects(setReaction(w.sales, ch.id, m.id, "bad emoji", true))).toBeInstanceOf(ValidationError);
  });

  it("counts unread per channel and in total, treats your own messages as read, and moves the marker only forward", async () => {
    const w = await world("ChatUnread");
    const ch = await createChannel(w.management, { kind: "PUBLIC", name: "news", memberIds: [w.sales.membershipId] });
    const other = await createChannel(w.management, { kind: "PRIVATE", name: "two", memberIds: [w.sales.membershipId] });
    await postMessage(w.management, ch.id, { body: "one" });
    await postMessage(w.management, ch.id, { body: "two @sales", mentions: [w.sales.membershipId] });
    await postMessage(w.management, other.id, { body: "three" });
    await postMessage(w.sales, ch.id, { body: "mine" });
    const list = await listChannels(w.sales);
    const byName = Object.fromEntries(list.items.map((c) => [c.name, c]));
    expect(byName.news).toMatchObject({ unread: 0, mentions: 0 });
    // The post above counted as reading everything before it, so go back to a clean slate for the count.
    await adminDb.chatReadMarker.updateMany({ where: { channelId: ch.id, membershipId: w.sales.membershipId }, data: { lastReadSeq: 0 } });
    const counted = await listChannels(w.sales);
    expect(counted.items.find((c) => c.id === ch.id)).toMatchObject({ unread: 2, mentions: 1 });
    expect(counted.items.find((c) => c.id === other.id)).toMatchObject({ unread: 1, mentions: 0 });
    expect(counted.unreadTotal).toBe(3);
    expect(await getUnreadTotals(w.sales)).toMatchObject({ unread: 3, mentions: 1 });
    expect(await markRead(w.sales, ch.id, 1)).toMatchObject({ unread: 1, mentions: 1 });
    expect(await markRead(w.sales, ch.id)).toMatchObject({ unread: 0, mentions: 0 });
    expect(await markRead(w.sales, ch.id, 0)).toMatchObject({ unread: 0 });
    expect((await getUnreadTotals(w.sales)).unread).toBe(1);
    // A person who has not joined has no marker to move.
    expect(await rejects(markRead(w.delivery, ch.id))).toBeInstanceOf(ValidationError);
  });

  it("starts a newcomer with nothing unread, and drops a leaver's marker", async () => {
    const w = await world("ChatJoin");
    const ch = await createChannel(w.management, { kind: "PUBLIC", name: "open" });
    await postMessage(w.management, ch.id, { body: "history" });
    const joined = await joinChannel(w.sales, ch.id);
    expect(joined).toMatchObject({ joined: true, unread: 0 });
    await removeMember(w.sales, ch.id, w.sales.membershipId);
    expect(await adminDb.chatReadMarker.count({ where: { channelId: ch.id, membershipId: w.sales.membershipId } })).toBe(0);
    // The last owner leaving hands the channel to the longest-standing member.
    await joinChannel(w.delivery, ch.id);
    await removeMember(w.management, ch.id, w.management.membershipId);
    expect((await adminDb.chatChannelMember.findMany({ where: { channelId: ch.id } })).map((m) => m.role)).toEqual(["OWNER"]);
  });

  it("lists channels in a fixed number of database calls however many there are", async () => {
    const w = await world("ChatQueries");
    const calls = async () => {
      const before = dbCallStats.orgContextCalls;
      await listChannels(w.sales);
      return dbCallStats.orgContextCalls - before;
    };
    for (let i = 0; i < 2; i += 1) {
      const c = await createChannel(w.sales, { kind: "PUBLIC", name: `q-a${i}` });
      await postMessage(w.sales, c.id, { body: "x" });
    }
    const few = await calls();
    for (let i = 0; i < 10; i += 1) {
      const c = await createChannel(w.sales, { kind: "PRIVATE", name: `q-b${i}`, memberIds: [w.management.membershipId] });
      await postMessage(w.management, c.id, { body: "y" });
    }
    await createChannel(w.sales, { kind: "DIRECT", memberIds: [w.delivery.membershipId] });
    expect((await listChannels(w.sales)).items.length).toBe(13);
    expect(await calls()).toBe(few);
  });

  it("posts once for a repeated Idempotency-Key and refuses the key for a different message", async () => {
    const w = await world("ChatIdem");
    const ch = await createChannel(w.sales, { kind: "PRIVATE", name: "idem" });
    const make = (body: object, key: string) => new Request("http://x.test/api/orgs/o/chat/channels/c/messages", { method: "POST", headers: { "idempotency-key": key } , body: JSON.stringify(body) });
    const body = { body: "double tap" };
    const first = (await withIdempotency(w.sales, make(body, "key-12345678"), body, () => postMessage(w.sales, ch.id, body))) as { id: string };
    const replay = (await withIdempotency(w.sales, make(body, "key-12345678"), body, () => postMessage(w.sales, ch.id, body))) as Response;
    expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
    expect(((await replay.json()) as { id: string }).id).toBe(first.id);
    expect(await adminDb.chatMessage.count({ where: { channelId: ch.id } })).toBe(1);
    const other = { body: "different" };
    expect(await rejects(withIdempotency(w.sales, make(other, "key-12345678"), other, () => postMessage(w.sales, ch.id, other)))).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    // Channel creation is idempotent the same way.
    const spec = { kind: "PUBLIC" as const, name: "once" };
    const c1 = (await withIdempotency(w.sales, make(spec, "key-aaaaaaaa"), spec, () => createChannel(w.sales, spec))) as { id: string };
    const c2 = (await withIdempotency(w.sales, make(spec, "key-aaaaaaaa"), spec, () => createChannel(w.sales, spec))) as Response;
    expect(((await c2.json()) as { id: string }).id).toBe(c1.id);
    expect(await adminDb.chatChannel.count({ where: { organizationId: w.org.id, name: "once" } })).toBe(1);
  });
});

describe("B6.24 record channels and record cards", () => {
  it("lets only people who can open the record join or read its channel, and re-checks on every read", async () => {
    const w = await world("ChatRecord");
    const deal = await dealFor(w, w.sales);
    const ch = await createChannel(w.sales, { kind: "RECORD", record: { type: "DEAL", id: deal.id } });
    expect(ch).toMatchObject({ kind: "RECORD", record: { type: "DEAL", id: deal.id }, joined: true });
    // The same record gives the same channel.
    expect((await createChannel(w.management, { kind: "RECORD", record: { type: "DEAL", id: deal.id } })).id).toBe(ch.id);
    // Another salesperson, Delivery and Restricted Technical cannot open an open deal they do not own.
    for (const who of [w.salesB, w.delivery, w.technical]) {
      expect(await rejects(createChannel(who, { kind: "RECORD", record: { type: "DEAL", id: deal.id } })), who.roleKey).toBeInstanceOf(NotFoundError);
      expect(await rejects(joinChannel(who, ch.id))).toBeInstanceOf(NotFoundError);
      expect((await listChannels(who)).items.find((c) => c.id === ch.id)).toBeUndefined();
    }
    // A person who cannot open the record cannot be added to the channel either.
    expect(await rejects(addMembers(w.sales, ch.id, [w.delivery.membershipId]))).toBeInstanceOf(ValidationError);
    // Management can open every deal.
    await postMessage(w.sales, ch.id, { body: "hello" });
    expect((await listMessages(w.management, ch.id)).items).toHaveLength(1);
    // Hand the deal to another salesperson: the old owner stops being able to read, at once.
    await joinChannel(w.management, ch.id);
    await adminDb.deal.update({ where: { id: deal.id }, data: { ownerMembershipId: w.salesB.membershipId } });
    expect(await rejects(listMessages(w.sales, ch.id))).toBeInstanceOf(NotFoundError);
    expect(await rejects(postMessage(w.sales, ch.id, { body: "still here?" }))).toBeInstanceOf(NotFoundError);
    expect((await listChannels(w.sales)).items.find((c) => c.id === ch.id)).toBeUndefined();
  });

  it("decides a record card by the person looking: value, payments and 'no access'", async () => {
    const w = await world("ChatCard");
    const deal = await dealFor(w, w.sales, 480000, { won: true });
    const invoice = await adminDb.invoice.create({ data: { organizationId: w.org.id, dealId: deal.id, companyId: deal.companyId, number: "INV-CARD-1", amount: 120000, issuedOn: new Date("2026-10-01"), dueOn: new Date("2026-10-31"), status: "SENT" } });
    const general = await createChannel(w.management, { kind: "PUBLIC", name: "cards", memberIds: [w.sales.membershipId, w.delivery.membershipId, w.finance.membershipId] });
    const posted = await postMessage(w.sales, general.id, { body: "sharing the deal", card: { type: "DEAL", id: deal.id } });
    expect(posted.card).toMatchObject({ noAccess: false, value: 480000, paymentDue: null });
    const asSeenBy = async (who: AuthContext) => (await listMessages(who, general.id)).items[0]!.card!;
    expect(await asSeenBy(w.management)).toMatchObject({ noAccess: false, value: 480000, paymentDue: 120000 });
    expect(await asSeenBy(w.finance)).toMatchObject({ noAccess: false, value: 480000, paymentDue: 120000 });
    // Delivery may open a won deal but may not see its value or its payments (hard rule 7).
    expect(await asSeenBy(w.delivery)).toMatchObject({ noAccess: false, value: null, paymentDue: null });
    // The owner sees their own value but never payments.
    expect(await asSeenBy(w.sales)).toMatchObject({ value: 480000, paymentDue: null });
    // Another salesperson cannot open the deal: no card at all, only 'no access'.
    const salesBView = await listMessages(await joinAs(w, w.salesB, general.id), general.id);
    expect(salesBView.items[0]!.card).toEqual({ type: "DEAL", id: deal.id, noAccess: true, name: null });

    // An invoice card: only Finance and Management may post or see it.
    expect(await rejects(postMessage(w.sales, general.id, { card: { type: "INVOICE", id: invoice.id } }))).toBeInstanceOf(NotFoundError);
    expect(await rejects(postMessage(w.delivery, general.id, { card: { type: "INVOICE", id: invoice.id } }))).toBeInstanceOf(NotFoundError);
    await postMessage(w.finance, general.id, { body: "Invoice is out. KES 120,000 due", card: { type: "INVOICE", id: invoice.id } });
    const messages = async (who: AuthContext) => (await listMessages(who, general.id)).items[1]!;
    const asFinance = await messages(w.finance);
    expect(asFinance.card).toMatchObject({ noAccess: false, value: 120000 });
    expect(asFinance.body).toContain("120,000");
    for (const who of [w.sales, w.delivery]) {
      const seen = await messages(who);
      expect(seen.card).toMatchObject({ noAccess: true, name: null });
      expect(JSON.stringify(seen)).not.toMatch(/120[,.]?000|INV-CARD-1/);
      expect(seen.body).toContain("[value hidden]");
    }
    // Search never finds a figure that is hidden from the searcher.
    expect((await searchMessages(w.delivery, "120,000")).items).toEqual([]);
    expect((await searchMessages(w.finance, "120,000")).items).toHaveLength(1);
  });

  it("hides the figures typed in a deal's own channel from someone who may not see its value", async () => {
    const w = await world("ChatDealText");
    const deal = await dealFor(w, w.sales, 480000, { won: true });
    const ch = await createChannel(w.sales, { kind: "RECORD", record: { type: "DEAL", id: deal.id } });
    await joinChannel(w.delivery, ch.id);
    await postMessage(w.sales, ch.id, { body: "Deposit of KES 120,000 expected" });
    expect((await listMessages(w.delivery, ch.id)).items[0]!.body).toBe("Deposit of [value hidden] expected");
    expect((await listMessages(w.sales, ch.id)).items[0]!.body).toBe("Deposit of KES 120,000 expected");
    expect((await searchMessages(w.delivery, "120,000")).items).toEqual([]);
  });
});

async function joinAs(w: World, who: AuthContext, channelId: string) {
  await joinChannel(who, channelId);
  return who;
}

describe("B6.25 delivery: sync, catch-up, presence, typing", () => {
  it("returns exactly the messages above what the client holds, with no gap and no repeat across reconnects", async () => {
    const w = await world("ChatSync");
    const ch = await createChannel(w.management, { kind: "PUBLIC", name: "sync", memberIds: [w.sales.membershipId] });
    await postMessage(w.management, ch.id, { body: "1" });
    await postMessage(w.management, ch.id, { body: "2" });
    // First call: state only for a channel the client holds nothing of.
    const first = await syncChat(w.sales, {});
    expect(first.messages).toEqual([]);
    expect(first.channels.find((c) => c.channelId === ch.id)).toMatchObject({ lastSeq: 2, unread: 2 });
    // Catch up from what it holds (0), then from the new head.
    const known: Record<string, number> = { [ch.id]: 0 };
    const seen: number[] = [];
    let since: Date | undefined;
    for (let round = 0; round < 3; round += 1) {
      if (round === 1) await postMessage(w.management, ch.id, { body: "3" });
      if (round === 2) await Promise.all([postMessage(w.management, ch.id, { body: "4" }), postMessage(w.management, ch.id, { body: "5" })]);
      const res = await syncChat(w.sales, { known, since });
      for (const m of res.messages) {
        seen.push(m.seq);
        known[m.channelId] = Math.max(known[m.channelId] ?? 0, m.seq);
      }
      since = res.serverTime;
    }
    expect(seen).toEqual([1, 2, 3, 4, 5]);
    // A client that slept through everything gets the same messages once.
    const cold = await syncChat(w.sales, { known: { [ch.id]: 0 } });
    expect(cold.messages.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(cold.messages.map((m) => m.id)).size).toBe(5);
    expect((await syncChat(w.sales, { known: { [ch.id]: 5 } })).messages).toEqual([]);
  });

  it("returns changes to messages the client already holds (deleted, reacted to)", async () => {
    const w = await world("ChatChanged");
    const ch = await createChannel(w.management, { kind: "PUBLIC", name: "changes", memberIds: [w.sales.membershipId] });
    const m = await postMessage(w.management, ch.id, { body: "hello" });
    const since = new Date();
    await new Promise((r) => setTimeout(r, 30));
    await setReaction(w.sales, ch.id, m.id, "🎉", true);
    const res = await syncChat(w.management, { known: { [ch.id]: 1 }, since });
    expect(res.updated.map((u) => [u.id, u.reactions[0]?.count])).toEqual([[m.id, 1]]);
    await deleteMessage(w.management, ch.id, m.id);
    const res2 = await syncChat(w.sales, { known: { [ch.id]: 1 }, since });
    // A client that is up to date, with a `since` after the change (beyond the overlap), is told nothing.
    expect((await syncChat(w.sales, { known: { [ch.id]: 1 }, since: new Date(Date.now() + 60_000) })).updated).toEqual([]);
    expect(res2.updated[0]).toMatchObject({ id: m.id, deleted: true, body: null });
  });

  it("stops delivering to a removed member at their next call, and never returns a channel they left", async () => {
    const w = await world("ChatRemoved");
    const ch = await createChannel(w.management, { kind: "PRIVATE", name: "crew", memberIds: [w.sales.membershipId] });
    await postMessage(w.management, ch.id, { body: "before" });
    expect((await syncChat(w.sales, { known: { [ch.id]: 0 } })).messages).toHaveLength(1);
    await removeMember(w.management, ch.id, w.sales.membershipId);
    await postMessage(w.management, ch.id, { body: "after" });
    const res = await syncChat(w.sales, { known: { [ch.id]: 1 } });
    expect(res.messages).toEqual([]);
    expect(res.channels.map((c) => c.channelId)).not.toContain(ch.id);
  });

  it("holds a long poll until a message arrives, and ends it when the person loses access", async () => {
    const w = await world("ChatLong");
    const ch = await createChannel(w.management, { kind: "PUBLIC", name: "long", memberIds: [w.sales.membershipId] });
    const started = Date.now();
    const waiting = syncChat(w.sales, { known: { [ch.id]: 0 }, waitSeconds: 8 });
    setTimeout(() => void postMessage(w.management, ch.id, { body: "wake up" }), 700);
    const res = await waiting;
    expect(res.messages.map((m) => m.body)).toEqual(["wake up"]);
    expect(Date.now() - started).toBeLessThan(5000);
    // With nothing happening it returns at the deadline, empty.
    const idle = Date.now();
    expect((await syncChat(w.sales, { known: { [ch.id]: 1 }, waitSeconds: 2 })).messages).toEqual([]);
    expect(Date.now() - idle).toBeGreaterThanOrEqual(900);
  }, 20000);

  it("tracks presence with a short expiry and typing for six seconds", async () => {
    const w = await world("ChatPresence");
    const ch = await createChannel(w.management, { kind: "PUBLIC", name: "here", memberIds: [w.sales.membershipId] });
    await heartbeat(w.sales, "AWAY");
    const res = await syncChat(w.management, {});
    expect(res.online.find((o) => o.membershipId === w.sales.membershipId)).toMatchObject({ status: "AWAY" });
    await setTyping(w.sales, ch.id);
    const typing = await syncChat(w.management, {});
    expect(typing.channels.find((c) => c.channelId === ch.id)!.typing.map((t) => t.membershipId)).toEqual([w.sales.membershipId]);
    // Not shown to the typist themselves.
    expect((await syncChat(w.sales, {})).channels.find((c) => c.channelId === ch.id)!.typing).toEqual([]);
    // Expired presence and typing disappear.
    await adminDb.chatPresence.updateMany({ where: { organizationId: w.org.id, membershipId: w.sales.membershipId }, data: { lastSeenAt: new Date(Date.now() - 120_000), typingUntil: new Date(Date.now() - 1000) } });
    const later = await syncChat(w.management, {});
    expect(later.online.map((o) => o.membershipId)).not.toContain(w.sales.membershipId);
    expect(later.channels.find((c) => c.channelId === ch.id)!.typing).toEqual([]);
    // Typing needs membership.
    expect(await rejects(setTyping(w.delivery, ch.id))).toBeInstanceOf(NotFoundError);
  });
});

describe("B6.25 and B6.26 mentions: notifications and push", () => {
  it("notifies a mentioned person and a direct-message partner only where they may see the record, with money hidden", async () => {
    const w = await world("ChatNotify");
    const deal = await dealFor(w, w.sales, 480000);
    const general = await createChannel(w.management, { kind: "PUBLIC", name: "team", memberIds: [w.sales.membershipId, w.delivery.membershipId, w.finance.membershipId] });
    const message = await postMessage(w.sales, general.id, {
      body: "Check this deal, KES 480,000 @everyone",
      card: { type: "DEAL", id: deal.id },
      mentions: [w.management.membershipId, w.delivery.membershipId, w.finance.membershipId],
    });
    // The post queued a job.
    expect(await adminDb.backgroundJob.count({ where: { organizationId: w.org.id, type: "chat.notify" } })).toBeGreaterThanOrEqual(1);
    const result = await deliverChatNotifications(w.org.id, message.id);
    const got = async (who: AuthContext) => adminDb.notification.findMany({ where: { organizationId: w.org.id, membershipId: who.membershipId, entityType: "ChatMessage", entityId: message.id } });
    // Management may open every deal; Delivery and Finance cannot open an open deal they do not own: no notification, no leak.
    expect(await got(w.management)).toHaveLength(1);
    expect(await got(w.delivery)).toHaveLength(0);
    expect(await got(w.finance)).toHaveLength(0);
    expect(result.notified).toBe(1);
    // Repeating the job does not notify twice per person... (one more delivery is acceptable only if deduplicated)
    // A plain mention (no record) reaches everyone mentioned, with the figure hidden from people without value access.
    const plain = await postMessage(w.sales, general.id, { body: "Quote is KES 90,000, fyi", mentions: [w.delivery.membershipId, w.management.membershipId] });
    await deliverChatNotifications(w.org.id, plain.id);
    const forDelivery = await adminDb.notification.findFirstOrThrow({ where: { organizationId: w.org.id, membershipId: w.delivery.membershipId, entityId: plain.id } });
    expect(forDelivery.body).toContain("[value hidden]");
    expect(forDelivery.body).not.toContain("90,000");
    const forManagement = await adminDb.notification.findFirstOrThrow({ where: { organizationId: w.org.id, membershipId: w.management.membershipId, entityId: plain.id } });
    expect(forManagement.body).toContain("90,000");
    // A direct message notifies the other person.
    const dm = await createChannel(w.sales, { kind: "DIRECT", memberIds: [w.finance.membershipId] });
    const dmMessage = await postMessage(w.sales, dm.id, { body: "Can you chase the deposit?" });
    await deliverChatNotifications(w.org.id, dmMessage.id);
    expect(await adminDb.notification.count({ where: { organizationId: w.org.id, membershipId: w.finance.membershipId, entityId: dmMessage.id } })).toBe(1);
    expect(await adminDb.notification.count({ where: { organizationId: w.org.id, membershipId: w.sales.membershipId, entityId: dmMessage.id } })).toBe(0);
  });

  it("stores a mention only for a person who can read a private channel", async () => {
    const w = await world("ChatMentionPrivate");
    const ch = await createChannel(w.sales, { kind: "PRIVATE", name: "closed", memberIds: [w.salesB.membershipId] });
    const m = await postMessage(w.sales, ch.id, { body: "hi", mentions: [w.salesB.membershipId, w.finance.membershipId] });
    expect(m.mentions).toEqual([w.salesB.membershipId]);
    await deliverChatNotifications(w.org.id, m.id);
    expect(await adminDb.notification.count({ where: { organizationId: w.org.id, membershipId: w.finance.membershipId } })).toBe(0);
  });
});

describe("B6.24 to B6.26 tenant isolation: every call with the other organisation's ids", () => {
  it("lets organisation A see, read, post to, join and subscribe to nothing of organisation B's", async () => {
    const A = await world("ChatIsoA");
    const B = await world("ChatIsoB");
    const publicB = await createChannel(B.management, { kind: "PUBLIC", name: "b-public", memberIds: [B.sales.membershipId] });
    const privateB = await createChannel(B.management, { kind: "PRIVATE", name: "b-private", memberIds: [B.sales.membershipId] });
    const dealB = await dealFor(B, B.sales);
    const recordB = await createChannel(B.management, { kind: "RECORD", record: { type: "DEAL", id: dealB.id } });
    const msgB = await postMessage(B.management, publicB.id, { body: "b-secret-text" });
    await setReaction(B.sales, publicB.id, msgB.id, "👍", true);

    for (const caller of [A.management, A.sales]) {
      const ids = [publicB.id, privateB.id, recordB.id];
      expect((await listChannels(caller)).items.map((c) => c.id).filter((id) => ids.includes(id))).toEqual([]);
      for (const id of ids) {
        expect(await rejects(getChannel(caller, id))).toBeInstanceOf(NotFoundError);
        expect(await rejects(listMessages(caller, id))).toBeInstanceOf(NotFoundError);
        expect(await rejects(postMessage(caller, id, { body: "planted" }))).toBeInstanceOf(NotFoundError);
        expect(await rejects(joinChannel(caller, id))).toBeInstanceOf(NotFoundError);
        expect(await rejects(markRead(caller, id))).toBeInstanceOf(NotFoundError);
        expect(await rejects(listMembers(caller, id))).toBeInstanceOf(NotFoundError);
        expect(await rejects(addMembers(caller, id, [caller.membershipId]))).toBeInstanceOf(NotFoundError);
        expect(await rejects(updateChannel(caller, id, { name: "taken over" }))).toBeInstanceOf(NotFoundError);
        expect(await rejects(deleteChannel(caller, id))).toBeInstanceOf(NotFoundError);
        expect(await rejects(removeMember(caller, id, B.sales.membershipId))).toBeInstanceOf(NotFoundError);
        expect(await rejects(setTyping(caller, id))).toBeInstanceOf(NotFoundError);
      }
      expect(await rejects(deleteMessage(caller, publicB.id, msgB.id))).toBeInstanceOf(NotFoundError);
      expect(await rejects(setReaction(caller, publicB.id, msgB.id, "👍", false))).toBeInstanceOf(NotFoundError);
      // Subscribing: a sync that claims B's channels learns nothing and receives nothing.
      const sync = await syncChat(caller, { known: { [publicB.id]: 0, [privateB.id]: 0, [recordB.id]: 0 } });
      expect(sync.messages).toEqual([]);
      expect(sync.channels.map((c) => c.channelId).filter((id) => ids.includes(id))).toEqual([]);
      expect(JSON.stringify(sync)).not.toContain("b-secret-text");
      expect((await searchMessages(caller, "b-secret")).items).toEqual([]);
      // Cards and mentions cannot name B's records or people.
      const own = await createChannel(caller, { kind: "PRIVATE", name: `own-${caller.roleKey}` });
      expect(await rejects(postMessage(caller, own.id, { body: "x", card: { type: "DEAL", id: dealB.id } }))).toBeInstanceOf(NotFoundError);
      expect(await rejects(postMessage(caller, own.id, { body: "x", mentions: [B.sales.membershipId] }))).toBeInstanceOf(ValidationError);
      expect(await rejects(createChannel(caller, { kind: "DIRECT", memberIds: [B.sales.membershipId] }))).toBeInstanceOf(ValidationError);
      expect(await rejects(createChannel(caller, { kind: "RECORD", record: { type: "DEAL", id: dealB.id } }))).toBeInstanceOf(NotFoundError);
    }
    expect((await getUnreadTotals(A.sales)).unread).toBe(0);
  });

  it("is enforced by row-level security on every chat table, not only by the service", async () => {
    const A = await world("ChatRlsA");
    const B = await world("ChatRlsB");
    const ch = await createChannel(B.management, { kind: "PUBLIC", name: "rls" });
    const msg = await postMessage(B.management, ch.id, { body: "hidden" });
    await heartbeat(B.management);
    const tables = ["chat_channels", "chat_channel_members", "chat_messages", "chat_message_mentions", "chat_message_attachments", "chat_reactions", "chat_read_markers", "chat_presence"];
    for (const table of tables) {
      const seen = await withOrgContext(A.org.id, (tx) => tx.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${table}" WHERE organization_id = $1`, B.org.id));
      expect(seen[0]!.n, table).toBe(0);
    }
    // Writes into B from A's context are refused by the policy.
    await expect(withOrgContext(A.org.id, (tx) => tx.chatChannel.create({ data: { organizationId: B.org.id, kind: "PUBLIC", name: "planted" } }))).rejects.toThrow(/row-level security/i);
    await expect(withOrgContext(A.org.id, (tx) => tx.chatMessage.create({ data: { organizationId: B.org.id, channelId: ch.id, seq: 99, body: "planted" } }))).rejects.toThrow(/row-level security/i);
    await expect(withOrgContext(A.org.id, (tx) => tx.chatReaction.create({ data: { organizationId: B.org.id, messageId: msg.id, membershipId: B.management.membershipId, emoji: "x" } }))).rejects.toThrow(/row-level security/i);
    // A row in A cannot point into B (composite foreign key).
    await expect(adminDb.chatMessage.create({ data: { organizationId: A.org.id, channelId: ch.id, seq: 98, body: "cross" } })).rejects.toThrow();
    await expect(adminDb.chatChannelMember.create({ data: { organizationId: A.org.id, channelId: ch.id, membershipId: A.sales.membershipId } })).rejects.toThrow();
  });
});

describe("B6.26 search, audit and the demo seed", () => {
  it("returns chat messages in global search only for people who may read them", async () => {
    const w = await world("ChatSearch");
    const general = await createChannel(w.management, { kind: "PUBLIC", name: "talk", memberIds: [w.sales.membershipId] });
    const secret = await createChannel(w.management, { kind: "PRIVATE", name: "leaders", memberIds: [w.sales.membershipId] });
    await postMessage(w.management, general.id, { body: "the zebra launch is Friday" });
    await postMessage(w.management, secret.id, { body: "zebra budget is private" });
    const group = (r: Awaited<ReturnType<typeof searchAll>>) => r.groups.find((g) => g.type === "messages");
    expect(group(await searchAll(w.sales, { q: "zebra" }))?.items.map((i) => i.label).sort()).toEqual(["the zebra launch is Friday", "zebra budget is private"]);
    // Delivery may read the public channel but is not in the private one.
    expect(group(await searchAll(w.delivery, { q: "zebra" }))?.items.map((i) => i.label)).toEqual(["the zebra launch is Friday"]);
    // Restricted Technical was added to neither: the messages group is there but empty.
    expect(group(await searchAll(w.technical, { q: "zebra" }))?.total).toBe(0);
    // Paged on its own, like any group.
    const only = await searchAll(w.sales, { q: "zebra", type: "messages" });
    expect(only.groups.map((g) => g.type)).toEqual(["messages"]);
    // Without the key there is no messages group at all, and the record groups behave as before.
    const noChat = { ...w.sales, permissionKeys: w.sales.permissionKeys.filter((k) => !k.startsWith("chat.")) };
    expect((await searchAll(noChat, { q: "zebra" })).groups.find((g) => g.type === "messages")).toBeUndefined();
  });

  it("writes an audit entry for channel create, rename, archive, delete, member changes and message deletes, without the message text", async () => {
    const w = await world("ChatAudit");
    const ch = await createChannel(w.management, { kind: "PRIVATE", name: "audited", memberIds: [w.sales.membershipId] });
    const m = await postMessage(w.sales, ch.id, { body: "private words" });
    await addMembers(w.management, ch.id, [w.delivery.membershipId]);
    await removeMember(w.management, ch.id, w.delivery.membershipId);
    await removeMember(w.sales, ch.id, w.sales.membershipId);
    await joinChannel(w.management, ch.id).catch(() => undefined);
    await deleteMessage(w.management, ch.id, m.id);
    await updateChannel(w.management, ch.id, { archived: true });
    await deleteChannel(w.management, ch.id);
    const log = await listOrganizationAuditLog(w.management, {}, { pageSize: 100 });
    const chatRows = log.items.filter((r) => String(r.action).startsWith("chat."));
    expect(chatRows.map((r) => r.action).sort()).toEqual(["chat.channel_archived", "chat.channel_created", "chat.channel_deleted", "chat.member_added", "chat.member_left", "chat.member_removed", "chat.message_deleted"].sort());
    expect(JSON.stringify(chatRows)).not.toContain("private words");
    expect(chatRows.find((r) => r.action === "chat.channel_created")).toMatchObject({ actor: { membershipId: w.management.membershipId } });
    // Sales has no audit permission.
    expect(await rejects(listOrganizationAuditLog(w.sales, {}, {}))).toBeInstanceOf(ForbiddenError);
  });

  it("seeds the demo channels once, for the dev organisation only", async () => {
    const w = await world("ChatSeed");
    const members = new Map<string, string>([["mg", w.management.membershipId], ["s1", w.sales.membershipId], ["s2", w.salesB.membershipId], ["dl", w.delivery.membershipId], ["fn", w.finance.membershipId], ["tc", w.technical.membershipId]]);
    await seedDemoChat(w.org.id, members);
    await seedDemoChat(w.org.id, members);
    const channels = await adminDb.chatChannel.findMany({ where: { organizationId: w.org.id }, orderBy: { name: "asc" } });
    expect(channels.map((c) => c.name)).toEqual(["field-ops", "finance-desk", "general", "leadership", "sales-team"]);
    const leadership = channels.find((c) => c.name === "leadership")!;
    expect(leadership).toMatchObject({ kind: "PRIVATE", lastSeq: 1 });
    // The seeded data reads through the real API, with the same privacy rules.
    expect((await listChannels(w.sales)).items.map((c) => c.name).sort()).toEqual(["field-ops", "general", "sales-team"]);
    expect((await listChannels(w.management)).items.map((c) => c.name).sort()).toEqual(["field-ops", "finance-desk", "general", "leadership", "sales-team"]);
    expect((await listChannels(w.technical)).items.map((c) => c.name).sort()).toEqual(["field-ops", "general"]);
    // The seed itself refuses to run in production (the dev seed's guard covers this call).
    const { assertDevSeedAllowed } = await import("../prisma/devSeed");
    expect(() => assertDevSeedAllowed({ NODE_ENV: "production", ALLOW_DEV_ACCOUNTS: "true" })).toThrow(/production/);
  });
});

describe("review fixes: closed record channels, retried notifications and files", () => {
  it("leaves out of the unread total a record channel whose record the person can no longer open", async () => {
    const w = await world("ChatUnreadClosed");
    const deal = await dealFor(w, w.sales, 100000);
    const ch = await createChannel(w.sales, { kind: "RECORD", record: { type: "DEAL", id: deal.id } });
    await createChannel(w.management, { kind: "RECORD", record: { type: "DEAL", id: deal.id } });
    await postMessage(w.management, ch.id, { body: "Please look at this deal" });
    expect((await getUnreadTotals(w.sales)).unread).toBe(1);
    await adminDb.deal.update({ where: { id: deal.id }, data: { ownerMembershipId: w.salesB.membershipId } });
    const after = await getUnreadTotals(w.sales);
    expect(after.unread).toBe(0);
    expect(after.channels[ch.id]).toBeUndefined();
  });

  it("notifies once per person per message even when the job is retried", async () => {
    const w = await world("ChatNotifyRetry");
    const general = await createChannel(w.management, { kind: "PUBLIC", name: "retry", memberIds: [w.sales.membershipId] });
    const message = await postMessage(w.sales, general.id, { body: "Look at this", mentions: [w.management.membershipId] });
    expect((await deliverChatNotifications(w.org.id, message.id)).notified).toBe(1);
    expect((await deliverChatNotifications(w.org.id, message.id)).notified).toBe(0);
    expect(await adminDb.notification.count({ where: { organizationId: w.org.id, membershipId: w.management.membershipId, entityType: "ChatMessage", entityId: message.id } })).toBe(1);
  });

  it("deletes the stored files of a deleted message and of a deleted channel", async () => {
    const w = await world("ChatDeleteFiles");
    const attach = async (messageId: string) => {
      const file = await adminDb.file.create({ data: { organizationId: w.org.id, ownerMembershipId: w.sales.membershipId, purpose: "ATTACHMENT", name: "a.png", sizeBytes: 10, mimeType: "image/png", storageKey: `orgs/${w.org.id}/chat-test/${messageId}-${Math.random()}`, status: "READY" } });
      await adminDb.chatMessageAttachment.create({ data: { organizationId: w.org.id, messageId, fileId: file.id } });
      return file.id;
    };
    const ch = await createChannel(w.sales, { kind: "PRIVATE", name: "files", memberIds: [w.salesB.membershipId] });
    const m1 = await postMessage(w.sales, ch.id, { body: "first" });
    const f1 = await attach(m1.id);
    await deleteMessage(w.sales, ch.id, m1.id);
    expect((await adminDb.file.findUniqueOrThrow({ where: { id: f1 } })).status).toBe("DELETED");
    const m2 = await postMessage(w.sales, ch.id, { body: "second" });
    const f2 = await attach(m2.id);
    await updateChannel(w.sales, ch.id, { archived: true } as never);
    await deleteChannel(w.sales, ch.id);
    expect((await adminDb.file.findUniqueOrThrow({ where: { id: f2 } })).status).toBe("DELETED");
  });
});
