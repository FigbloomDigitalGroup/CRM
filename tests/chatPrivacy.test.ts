/** Chat privacy (FIG-1385, B6.27): retention, export, erasure of a member, contact erasure, cross-organisation. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import type { AuthContext } from "../src/auth/context";
import { createChannel, listMessages, postMessage, setReaction } from "../src/services/chatService";
import { eraseChatMessagesNaming, eraseMemberChat, exportOrganisationChat, purgeChatMessages } from "../src/services/chatPrivacyService";
import { runRetentionSweep } from "../src/services/privacyService";
import { updateRetention, getPrivacyOverview } from "../src/services/privacyService";
import { setLegalHold } from "../src/services/privacyService";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";

const ORIGINAL = process.env.ACTIVE_RELEASE;
beforeAll(() => {
  process.env.ACTIVE_RELEASE = "v1.1";
});
afterAll(() => {
  if (ORIGINAL === undefined) delete process.env.ACTIVE_RELEASE;
  else process.env.ACTIVE_RELEASE = ORIGINAL;
});

async function world(prefix: string) {
  const org = await createTestOrganization(prefix);
  const management = await createTestContext(org.id, "MANAGEMENT", "m");
  const sales = await createTestContext(org.id, "SALES", "s");
  const delivery = await createTestContext(org.id, "DELIVERY", "d");
  await adminDb.user.update({ where: { id: sales.userId }, data: { name: "Wanjiru Kamau" } });
  return { org, management, sales, delivery };
}
const age = (organizationId: string, days: number) => adminDb.chatMessage.updateMany({ where: { organizationId }, data: { createdAt: new Date(Date.now() - days * 86_400_000) } });

describe("B6.27 retention", () => {
  it("offers a chat retention setting, kept until set, and purges older messages by the job, audited", async () => {
    const w = await world("ChatRet");
    expect((await getPrivacyOverview(w.management)).retention.find((r) => r.key === "chatMessages")).toMatchObject({ value: null });
    const ch = await createChannel(w.management, { kind: "PUBLIC", name: "ret", memberIds: [w.sales.membershipId] });
    await postMessage(w.management, ch.id, { body: "old one" });
    await postMessage(w.sales, ch.id, { body: "old two" });
    await age(w.org.id, 100);
    await postMessage(w.management, ch.id, { body: "fresh" });
    // Nothing is purged until a period is set.
    expect((await runRetentionSweep(w.org.id)).purged.chatMessages).toBeUndefined();
    await updateRetention(w.management, { chatMessages: 30 });
    await setLegalHold(w.management, { active: true, reason: "dispute" });
    expect((await runRetentionSweep(w.org.id)).skipped).toBe("LEGAL_HOLD");
    expect(await adminDb.chatMessage.count({ where: { organizationId: w.org.id } })).toBe(3);
    await setLegalHold(w.management, { active: false });
    expect((await runRetentionSweep(w.org.id)).purged.chatMessages).toBe(2);
    expect((await listMessages(w.management, ch.id)).items.map((m) => m.body)).toEqual(["fresh"]);
    const audit = await adminDb.auditEvent.findFirstOrThrow({ where: { organizationId: w.org.id, action: "retention.purged" } });
    expect(audit.metadata).toMatchObject({ chatMessages: 2 });
    expect(await purgeChatMessages(w.org.id, new Date())).toBe(1);
  });
});

describe("B6.27 export", () => {
  it("contains the organisation's chat and nothing from another organisation", async () => {
    const A = await world("ChatExpA");
    const B = await world("ChatExpB");
    const a = await createChannel(A.management, { kind: "PUBLIC", name: "a-channel", memberIds: [A.sales.membershipId] });
    const am = await postMessage(A.management, a.id, { body: "a-text" });
    await setReaction(A.sales, a.id, am.id, "👍", true);
    const b = await createChannel(B.management, { kind: "PRIVATE", name: "b-channel" });
    await postMessage(B.management, b.id, { body: "b-text" });
    const out = await exportOrganisationChat(A.org.id);
    expect(out.channels.map((c) => c.name)).toEqual(["a-channel"]);
    expect(out.messages.map((m) => m.body)).toEqual(["a-text"]);
    expect(out.reactions).toHaveLength(1);
    expect(out.members).toHaveLength(2);
    const text = JSON.stringify(out);
    expect(text).not.toContain("b-text");
    expect(text).not.toContain("b-channel");
    expect(text).not.toContain(B.org.id);
  });
});

describe("B6.27 erasure", () => {
  it("anonymises a member's messages with an audit entry, and removes their other traces", async () => {
    const w = await world("ChatErase");
    const ch = await createChannel(w.management, { kind: "PUBLIC", name: "erase", memberIds: [w.sales.membershipId, w.delivery.membershipId] });
    const mine = await postMessage(w.sales, ch.id, { body: "my private opinion" });
    const other = await postMessage(w.management, ch.id, { body: "thanks @Wanjiru Kamau", mentions: [w.sales.membershipId] });
    await setReaction(w.delivery, ch.id, mine.id, "👍", true);
    await setReaction(w.sales, ch.id, other.id, "🎉", true);
    const dm = await createChannel(w.sales, { kind: "DIRECT", memberIds: [w.delivery.membershipId] });
    await postMessage(w.delivery, dm.id, { body: "ping" });
    const result = await eraseMemberChat({ organizationId: w.org.id, membershipId: w.sales.membershipId, actorMembershipId: w.management.membershipId });
    expect(result).toMatchObject({ policy: "ANONYMISE", messagesAnonymised: 1, mentionsScrubbed: 2, membershipsRemoved: 2 });
    const rows = await adminDb.chatMessage.findMany({ where: { channelId: ch.id }, orderBy: { seq: "asc" } });
    expect(rows[0]).toMatchObject({ body: "", authorMembershipId: null });
    expect(rows[0]!.erasedAt).not.toBeNull();
    expect(rows[1]!.body).toBe("thanks @[removed]");
    expect(await adminDb.chatReaction.count({ where: { organizationId: w.org.id, membershipId: w.sales.membershipId } })).toBe(0);
    expect(await adminDb.chatChannelMember.count({ where: { organizationId: w.org.id, membershipId: w.sales.membershipId } })).toBe(0);
    const seen = (await listMessages(w.management, ch.id)).items;
    expect(seen[0]).toMatchObject({ erased: true, body: null, authorMembershipId: null, authorName: null });
    // The partner's side of the direct message stays.
    expect(await adminDb.chatMessage.count({ where: { channelId: dm.id } })).toBe(1);
    const audit = await adminDb.auditEvent.findFirstOrThrow({ where: { organizationId: w.org.id, action: "chat.member_erased" } });
    expect(audit.actorMembershipId).toBe(w.management.membershipId);
    expect(JSON.stringify(audit)).not.toMatch(/my private opinion|Wanjiru/);
    // Repeating changes nothing more.
    expect(await eraseMemberChat({ organizationId: w.org.id, membershipId: w.sales.membershipId })).toMatchObject({ messagesAnonymised: 0, reactionsRemoved: 0 });
  });

  it("can delete the rows instead, under the DELETE policy", async () => {
    const w = await world("ChatEraseDel");
    const ch = await createChannel(w.management, { kind: "PUBLIC", name: "del", memberIds: [w.sales.membershipId] });
    await postMessage(w.sales, ch.id, { body: "gone" });
    await postMessage(w.management, ch.id, { body: "stays" });
    expect(await eraseMemberChat({ organizationId: w.org.id, membershipId: w.sales.membershipId, policy: "DELETE" })).toMatchObject({ messagesDeleted: 1 });
    expect((await adminDb.chatMessage.findMany({ where: { channelId: ch.id } })).map((m) => m.body)).toEqual(["stays"]);
  });

  it("erases only the named organisation's member, and a contact's details vanish from chat text", async () => {
    const A = await world("ChatEraseA");
    const B = await world("ChatEraseB");
    const a = await createChannel(A.management, { kind: "PUBLIC", name: "ca" });
    const b = await createChannel(B.management, { kind: "PUBLIC", name: "cb" });
    await postMessage(A.management, a.id, { body: "call wanjiku@personal.test about the quote" });
    await postMessage(B.management, b.id, { body: "call wanjiku@personal.test about the quote" });
    expect(await eraseChatMessagesNaming(A.org.id, ["wanjiku@personal.test"])).toBe(1);
    expect((await adminDb.chatMessage.findFirstOrThrow({ where: { channelId: a.id } })).erasedAt).not.toBeNull();
    expect((await adminDb.chatMessage.findFirstOrThrow({ where: { channelId: b.id } })).body).toContain("wanjiku@personal.test");
    // A member of B cannot be erased through A's organisation id.
    await expect(eraseMemberChat({ organizationId: A.org.id, membershipId: B.management.membershipId })).rejects.toThrow();
  });
});

export type _Unused = AuthContext;
