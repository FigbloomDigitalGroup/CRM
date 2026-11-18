import { describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { ValidationError } from "../src/auth/errors";
import {
  countUnread,
  expireOldNotifications,
  listNotificationCentre,
  setNotificationArchived,
} from "../src/services/notificationCentreService";
import { markAllNotificationsRead, markNotificationRead } from "../src/services/notificationService";
import * as leadService from "../src/services/leadService";
import { createTestContext, createTestOrganization, getLeadStatusId } from "./helpers/fixtures";

type Seed = Partial<{
  title: string;
  body: string;
  type: "LEAD_ASSIGNED" | "TASK_DUE" | "MENTION";
  entityType: string;
  entityId: string;
  link: string;
  readAt: Date;
  createdAt: Date;
}>;

async function setup() {
  const org = await createTestOrganization("Centre");
  const management = await createTestContext(org.id, "MANAGEMENT");
  const sales = await createTestContext(org.id, "SALES", "s");
  const statusId = await getLeadStatusId(org.id);
  const give = (membershipId: string, data: Seed = {}) =>
    adminDb.notification.create({
      data: { organizationId: org.id, membershipId, type: "TASK_DUE", title: "T", body: "B", ...data },
    });
  return { org, management, sales, statusId, give };
}

describe("notification centre (FIG-1040, B2.11)", () => {
  it("pages, filters by type and unread, and the unread count equals the unread list", async () => {
    const { management, give } = await setup();
    for (let i = 0; i < 5; i += 1) await give(management.membershipId, { title: `due ${i}`, type: "TASK_DUE" });
    await give(management.membershipId, { type: "MENTION", title: "mention", readAt: new Date() });

    const first = await listNotificationCentre(management, { paging: { pageSize: 2 } });
    expect(first.items).toHaveLength(2);
    expect(first.total).toBe(6);
    expect(first.nextCursor).not.toBeNull();
    expect(first.unreadCount).toBe(5);

    const mentions = await listNotificationCentre(management, { types: ["MENTION"] });
    expect(mentions.items.map((n) => n.title)).toEqual(["mention"]);
    const unread = await listNotificationCentre(management, { unreadOnly: true });
    expect(unread.total).toBe(first.unreadCount);
    expect(await countUnread(management)).toBe(unread.total);
    await expect(listNotificationCentre(management, { types: ["NOPE"] })).rejects.toBeInstanceOf(ValidationError);
  });

  it("mark one, mark all and archive; archived leave the default feed and the count", async () => {
    const { management, give } = await setup();
    const a = await give(management.membershipId, { title: "a" });
    const b = await give(management.membershipId, { title: "b" });
    await give(management.membershipId, { title: "c" });

    await markNotificationRead(management, a.id);
    expect(await countUnread(management)).toBe(2);
    await setNotificationArchived(management, b.id, true);
    expect(await countUnread(management)).toBe(1);
    const feed = await listNotificationCentre(management, {});
    expect(feed.items.map((n) => n.title)).not.toContain("b");
    const archived = await listNotificationCentre(management, { archived: true });
    expect(archived.items.map((n) => n.title)).toEqual(["b"]);
    await setNotificationArchived(management, b.id, false);
    expect((await listNotificationCentre(management, {})).total).toBe(3);
    await markAllNotificationsRead(management);
    expect(await countUnread(management)).toBe(0);
  });

  it("never shows another member's notification, and archiving someone else's does nothing", async () => {
    const { management, sales, give } = await setup();
    const mine = await give(management.membershipId, { title: "mine" });
    await give(sales.membershipId, { title: "theirs" });
    expect((await listNotificationCentre(sales, {})).items.map((n) => n.title)).toEqual(["theirs"]);
    expect((await setNotificationArchived(sales, mine.id, true)).updated).toBe(0);
    expect((await listNotificationCentre(management, {})).items.map((n) => n.title)).toEqual(["mine"]);
  });

  it("a notification about a record the member cannot open is not shown or counted", async () => {
    const { org, management, sales, statusId, give } = await setup();
    const salesB = await createTestContext(org.id, "SALES", "other");
    const { lead } = await leadService.createLead(salesB, { leadStatusId: statusId });
    await give(sales.membershipId, {
      type: "MENTION",
      title: "Mentioned",
      entityType: "Lead",
      entityId: lead.id,
      link: `https://app.test/o/${org.slug}/leads/${lead.id}`,
    });
    expect((await listNotificationCentre(sales, {})).total).toBe(0);
    expect(await countUnread(sales)).toBe(0);
    await give(management.membershipId, { title: "ok", link: `https://app.test/o/${org.slug}/leads/${lead.id}` });
    expect((await listNotificationCentre(management, {})).total).toBe(1);
  });

  it("redacts money in the text for roles without the value permission", async () => {
    const { management, sales, give } = await setup();
    await give(sales.membershipId, { title: "Deal won: KES 4,500,000", body: "Worth KES 4,500,000" });
    await give(management.membershipId, { title: "Deal won: KES 4,500,000", body: "Worth KES 4,500,000" });
    expect(JSON.stringify(await listNotificationCentre(sales, {}))).not.toContain("4,500,000");
    expect(JSON.stringify(await listNotificationCentre(management, {}))).toContain("4,500,000");
  });

  it("retention removes read notifications older than 90 days and keeps unread ones", async () => {
    const { org, management, give } = await setup();
    const old = new Date(Date.now() - 120 * 24 * 60 * 60_000);
    await give(management.membershipId, { title: "old read", readAt: old, createdAt: old });
    await give(management.membershipId, { title: "old unread", createdAt: old });
    await give(management.membershipId, { title: "fresh read", readAt: new Date() });
    expect((await expireOldNotifications(org.id)).deleted).toBe(1);
    const left = await adminDb.notification.findMany({ where: { organizationId: org.id } });
    expect(left.map((n) => n.title).sort()).toEqual(["fresh read", "old unread"]);
  });

  it("is isolated per organisation", async () => {
    const a = await setup();
    const b = await setup();
    await a.give(a.management.membershipId, { title: "org a" });
    expect((await listNotificationCentre(b.management, {})).total).toBe(0);
    expect((await expireOldNotifications(b.org.id)).deleted).toBe(0);
  });
});
