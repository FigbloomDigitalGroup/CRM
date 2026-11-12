import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../src/auth/context";
import { ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { withOrgContext } from "../src/db/orgScopedClient";
import { enqueueAndRunNow } from "../src/jobs/runner";
import { setPushTransport, type PushTransport } from "../src/notifications/webPush";
import { createCompany } from "../src/services/companyService";
import { createContact } from "../src/services/contactService";
import * as dealService from "../src/services/dealService";
import { createLead } from "../src/services/leadService";
import { inviteMember, removeMember } from "../src/services/membershipService";
import { getMyNotificationPreferencesV2, updateMyNotificationPreferencesV2 } from "../src/services/notificationPreferenceService";
import { listNotificationCentre } from "../src/services/notificationCentreService";
import { TEAM_DIGEST_JOB, emitTeamActivity, flushTeamActivityDigests, updateTeamActivityPreferences } from "../src/services/teamActivityNotifier";
import { createTestContext, createTestOrganization, getLeadStatusId, getLostReasonId, getPipelineStageId } from "./helpers/fixtures";

vi.mock("../src/notifications/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/notifications/email")>();
  return { ...actual, sendGenericNotificationEmail: vi.fn().mockResolvedValue(undefined), sendMembershipInviteEmail: vi.fn().mockResolvedValue(undefined) };
});
import * as email from "../src/notifications/email";

/**
 * FIG-1600 (P2-17): Management hears about team activity. Real services raise the events; the notifier tells every other
 * Management member of the same organisation through each person's own choices.
 */

const sent: { payload: string }[] = [];
const transport: PushTransport = {
  async send(_sub, payload) {
    sent.push({ payload });
    return { statusCode: 201 };
  },
};

beforeEach(() => {
  sent.length = 0;
  setPushTransport(transport);
  vi.mocked(email.sendGenericNotificationEmail).mockClear();
});
afterEach(() => setPushTransport(null));

async function setup() {
  const org = await createTestOrganization("TeamAct");
  const mgmtA = await createTestContext(org.id, "MANAGEMENT", "ta.a");
  const mgmtB = await createTestContext(org.id, "MANAGEMENT", "ta.b");
  const sales = await createTestContext(org.id, "SALES", "ta.s");
  await adminDb.user.update({ where: { id: sales.userId }, data: { name: "Amina Sales" } });
  return { org, mgmtA, mgmtB, sales };
}

const teamNotes = (ctx: AuthContext) =>
  adminDb.notification.findMany({ where: { organizationId: ctx.organizationId, membershipId: ctx.membershipId, type: "TEAM_ACTIVITY" }, orderBy: { createdAt: "asc" } });
const pending = (ctx: AuthContext) => adminDb.teamActivityPending.findMany({ where: { organizationId: ctx.organizationId, recipientMembershipId: ctx.membershipId } });

async function instantLeads(...people: AuthContext[]) {
  for (const p of people) await updateTeamActivityPreferences(p.organizationId, p.membershipId, { LEAD_CREATED: { mode: "INSTANT" } });
}

describe("a new lead", () => {
  it("tells the other Management member once, with the wording, the link and the actor, and tells nobody else", async () => {
    const { org, mgmtA, mgmtB, sales } = await setup();
    await instantLeads(mgmtA, mgmtB);
    const { company } = await createCompany(mgmtA, { name: "Acme Ltd" });
    const { lead } = await createLead(sales, { leadStatusId: await getLeadStatusId(org.id), companyId: company.id });

    const a = (await teamNotes(mgmtA)).filter((n) => n.entityId === lead.id);
    const b = (await teamNotes(mgmtB)).filter((n) => n.entityId === lead.id);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]!.title).toBe("Amina Sales added a lead: Acme Ltd");
    expect(a[0]!.link).toContain(`/leads/${lead.id}`);
    expect(a[0]!.actorMembershipId).toBe(sales.membershipId);
    expect(await teamNotes(sales)).toHaveLength(0); // the person who did it is never told

    const feed = await listNotificationCentre(mgmtA);
    expect(feed.items.find((i: { entityId: string | null }) => i.entityId === lead.id)).toMatchObject({ actorName: "Amina Sales", type: "TEAM_ACTIVITY" });
  });

  it("does not tell the actor even when the actor is Management", async () => {
    const { org, mgmtA, mgmtB } = await setup();
    await instantLeads(mgmtA, mgmtB);
    await createLead(mgmtA, { leadStatusId: await getLeadStatusId(org.id) });
    expect((await teamNotes(mgmtA)).length).toBe(0);
    expect((await teamNotes(mgmtB)).length).toBe(1);
  });

  it("turning an event off for one person stops it for that person only", async () => {
    const { org, mgmtA, mgmtB, sales } = await setup();
    await instantLeads(mgmtA, mgmtB);
    await updateTeamActivityPreferences(org.id, mgmtA.membershipId, { LEAD_CREATED: { inApp: false } });
    await createLead(sales, { leadStatusId: await getLeadStatusId(org.id) });
    expect(await teamNotes(mgmtA)).toHaveLength(0);
    expect(await pending(mgmtA)).toHaveLength(0);
    expect(await teamNotes(mgmtB)).toHaveLength(1);
  });

  it("never reaches another organisation", async () => {
    const one = await setup();
    const two = await setup();
    await instantLeads(one.mgmtA, two.mgmtA, two.mgmtB);
    await createLead(one.sales, { leadStatusId: await getLeadStatusId(one.org.id) });
    expect(await teamNotes(one.mgmtA)).toHaveLength(1);
    expect(await teamNotes(two.mgmtA)).toHaveLength(0);
    expect(await teamNotes(two.mgmtB)).toHaveLength(0);
    expect(await pending(two.mgmtA)).toHaveLength(0);
  });
});

describe("digests", () => {
  it("twelve leads in an hour become one grouped notification, sent when due, once", async () => {
    const { org, mgmtA, sales } = await setup();
    const statusId = await getLeadStatusId(org.id);
    for (let i = 0; i < 12; i++) await createLead(sales, { leadStatusId: statusId });
    expect(await teamNotes(mgmtA)).toHaveLength(0); // default for new leads is the hourly digest
    expect(await pending(mgmtA)).toHaveLength(12);

    const now = new Date();
    expect(await flushTeamActivityDigests(org.id, new Date(now.getTime() + 30 * 60_000))).toEqual({ groups: 0, items: 0 });
    const result = await flushTeamActivityDigests(org.id, new Date(now.getTime() + 61 * 60_000));
    expect(result.groups).toBe(2); // one for each Management member
    const notes = await teamNotes(mgmtA);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.title).toBe("Amina Sales added 12 leads in the last hour");
    expect(notes[0]!.link).toMatch(/\/leads$/);
    expect(await flushTeamActivityDigests(org.id, new Date(now.getTime() + 62 * 60_000))).toEqual({ groups: 0, items: 0 });
    expect(await teamNotes(mgmtA)).toHaveLength(1);
  });

  it("runs through the job framework", async () => {
    const { org, mgmtA, sales } = await setup();
    await createContact(sales, { firstName: "Wanjiru" });
    expect(await pending(mgmtA)).toHaveLength(1);
    await adminDb.teamActivityPending.updateMany({ where: { organizationId: org.id }, data: { createdAt: new Date(Date.now() - 2 * 60 * 60_000) } });
    const run = await enqueueAndRunNow({ organizationId: org.id, type: TEAM_DIGEST_JOB });
    expect(run.job?.status).toBe("SUCCEEDED");
    const notes = await teamNotes(mgmtA);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.title).toBe("Amina Sales added a contact: Wanjiru");
  });

  it("a daily digest waits for 08:00 on the person's own clock", async () => {
    const { org, mgmtA, sales } = await setup();
    await adminDb.user.update({ where: { id: mgmtA.userId }, data: { timeZone: "Africa/Nairobi" } });
    await updateTeamActivityPreferences(org.id, mgmtA.membershipId, { COMPANY_CREATED: { mode: "DAILY" } });
    await createCompany(sales, { name: "Daily Co" });
    const heldAt = (await pending(mgmtA))[0]!.createdAt;
    // After an hour only the other Management member (hourly by default) is told.
    expect((await flushTeamActivityDigests(org.id, new Date(heldAt.getTime() + 61 * 60_000))).groups).toBe(1);
    expect(await teamNotes(mgmtA)).toHaveLength(0);
    expect((await flushTeamActivityDigests(org.id, new Date(heldAt.getTime() + 25 * 60 * 60_000))).groups).toBe(1);
    expect(await teamNotes(mgmtA)).toHaveLength(1);
  });
});

describe("won, lost, new deal", () => {
  it("a won deal is instant and shows the value to Management in the app, the email and the push", async () => {
    const { org, mgmtA, mgmtB, sales } = await setup();
    await updateTeamActivityPreferences(org.id, mgmtB.membershipId, { DEAL_CLOSED: { email: true, push: true } });
    await adminDb.pushSubscription.create({ data: { organizationId: org.id, membershipId: mgmtB.membershipId, endpoint: "https://fcm.googleapis.com/fcm/send/abc", p256dh: "p", auth: "a" } });
    const { company } = await createCompany(sales, { name: "Big Co" });
    const deal = await dealService.createDeal(sales, { companyId: company.id, pipelineStageId: await getPipelineStageId(org.id), value: 1200000 });
    await dealService.updateDeal(sales, deal.id, { pipelineStageId: await getPipelineStageId(org.id, "CLOSED_WON") });

    const created = (await teamNotes(mgmtA)).filter((n) => n.title.includes("added a deal"));
    expect(created).toHaveLength(1);
    const won = (await teamNotes(mgmtA)).filter((n) => n.title.includes("won"));
    expect(won).toHaveLength(1);
    expect(won[0]!.title).toBe("Amina Sales marked a deal won: Big Co");
    expect(won[0]!.body).toContain("KES 1,200,000");
    expect(await teamNotes(sales)).toHaveLength(0);

    // Email (B opted in) and push carry the same text, with the value because Management may see values.
    const call = vi.mocked(email.sendGenericNotificationEmail).mock.calls.find(([, args]) => args.title.includes("won"));
    expect(call?.[1].body).toContain("KES 1,200,000");
    expect(sent.some((s) => JSON.parse(s.payload).body.includes("KES 1,200,000"))).toBe(true);
    for (const n of await teamNotes(mgmtA)) expect(`${n.title} ${n.body}`).not.toMatch(/payment|invoice/i);
  });

  it("a lost deal says lost", async () => {
    const { org, mgmtA, sales } = await setup();
    const { company } = await createCompany(sales, { name: "Lost Co" });
    const deal = await dealService.createDeal(sales, { companyId: company.id, pipelineStageId: await getPipelineStageId(org.id) });
    await dealService.updateDeal(sales, deal.id, { pipelineStageId: await getPipelineStageId(org.id, "CLOSED_LOST"), lostReasonId: await getLostReasonId(org.id) });
    expect((await teamNotes(mgmtA)).some((n) => n.title === "Amina Sales marked a deal lost: Lost Co")).toBe(true);
  });

  it("an edit that does not close the deal tells nobody", async () => {
    const { org, mgmtA, sales } = await setup();
    const { company } = await createCompany(sales, { name: "Open Co" });
    const deal = await dealService.createDeal(sales, { companyId: company.id, pipelineStageId: await getPipelineStageId(org.id) });
    const before = (await teamNotes(mgmtA)).length;
    await dealService.updateDeal(sales, deal.id, { notes: "just a note" });
    expect((await teamNotes(mgmtA)).length).toBe(before);
  });
});

describe("companies, contacts, members and the rest", () => {
  it("a new company and contact are held for the digest", async () => {
    const { mgmtA, sales } = await setup();
    await createCompany(sales, { name: "Held Co" });
    await createContact(sales, { firstName: "Held" });
    const held = await pending(mgmtA);
    expect(held.map((h) => h.eventKey).sort()).toEqual(["COMPANY_CREATED", "CONTACT_CREATED"]);
  });

  it("inviting and removing a member tell the other Management members", async () => {
    const { mgmtA, mgmtB } = await setup();
    await adminDb.user.update({ where: { id: mgmtA.userId }, data: { name: "Mary Manager" } });
    const { membershipId } = await inviteMember(mgmtA, { email: `ta.invitee.${Date.now()}@example.test`, name: "New Person", roleKey: "SALES" }, (t) => `https://x.test/${t}`);
    expect((await teamNotes(mgmtB)).some((n) => n.title === "Mary Manager invited New Person to the team")).toBe(true);
    expect(await teamNotes(mgmtA)).toHaveLength(0);
    await removeMember(mgmtA, membershipId);
    expect((await teamNotes(mgmtB)).some((n) => n.title === "Mary Manager removed New Person from the team")).toBe(true);
  });

  it("an import or export run and a large discount request use the same helper", async () => {
    const { org, mgmtA, sales } = await setup();
    await emitTeamActivity({ organizationId: org.id, eventKey: "DATA_RUN", actorMembershipId: sales.membershipId, entityType: "DataRun", entityId: "run-1", label: "a lead import", route: "settings", detail: { summary: "40 created" } });
    await emitTeamActivity({ organizationId: org.id, eventKey: "DISCOUNT_REQUESTED", actorMembershipId: sales.membershipId, entityType: "ApprovalRequest", entityId: "appr-1", label: "Q-1 v1: 25%", route: "approvals" });
    const titles = (await teamNotes(mgmtA)).map((n) => n.title);
    expect(titles).toContain("Amina Sales finished a lead import");
    expect(titles).toContain("Amina Sales asked approval for a discount: Q-1 v1: 25%");
  });

  it("caps instant notifications per person; the rest wait for the digest", async () => {
    const { org, mgmtA, sales } = await setup();
    for (let i = 0; i < 22; i++) {
      await emitTeamActivity({ organizationId: org.id, eventKey: "DEAL_CLOSED", actorMembershipId: sales.membershipId, entityType: "Deal", entityId: `d-${i}`, label: `Co ${i}`, route: "deals", detail: { outcome: "WON" } });
    }
    expect(await teamNotes(mgmtA)).toHaveLength(20);
    expect(await pending(mgmtA)).toHaveLength(2);
  });
});

describe("preferences", () => {
  it("Management sees one row per event with the defaults and can change channels and mode; Sales has none", async () => {
    const { mgmtA, sales } = await setup();
    const view = await getMyNotificationPreferencesV2(mgmtA);
    expect(view.teamActivity).toHaveLength(8);
    expect(view.teamActivity!.find((r) => r.event === "DEAL_CLOSED")).toMatchObject({ mode: "INSTANT", channels: { inApp: true, email: false, push: false } });
    expect(view.teamActivity!.find((r) => r.event === "LEAD_CREATED")!.mode).toBe("HOURLY");

    const next = await updateMyNotificationPreferencesV2(mgmtA, { teamActivity: { LEAD_CREATED: { email: true, mode: "DAILY" } } });
    expect(next.teamActivity!.find((r) => r.event === "LEAD_CREATED")).toMatchObject({ mode: "DAILY", channels: { inApp: true, email: true, push: false } });

    expect((await getMyNotificationPreferencesV2(sales)).teamActivity).toBeUndefined();
    await expect(updateMyNotificationPreferencesV2(sales, { teamActivity: { LEAD_CREATED: { email: true } } })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateMyNotificationPreferencesV2(mgmtA, { teamActivity: { LEAD_CREATED: { mode: "WEEKLY" } } })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateMyNotificationPreferencesV2(mgmtA, { teamActivity: { NOPE: { email: true } } })).rejects.toBeInstanceOf(ValidationError);
  });

  it("one person's choice never changes another person's", async () => {
    const { mgmtA, mgmtB } = await setup();
    await updateMyNotificationPreferencesV2(mgmtA, { teamActivity: { DEAL_CREATED: { inApp: false } } });
    const b = await getMyNotificationPreferencesV2(mgmtB);
    expect(b.teamActivity!.find((r) => r.event === "DEAL_CREATED")!.channels.inApp).toBe(true);
  });
});

describe("tenant isolation of the new tables", () => {
  it("row-level security hides another organisation's preferences and held items", async () => {
    const one = await setup();
    const two = await setup();
    await updateTeamActivityPreferences(one.org.id, one.mgmtA.membershipId, { DEAL_CREATED: { inApp: false } });
    await createCompany(one.sales, { name: "Isolated Co" });
    const seenFromTwo = await withOrgContext(two.org.id, async (tx) => ({
      prefs: await tx.teamActivityPreference.findMany({}),
      pending: await tx.teamActivityPending.findMany({}),
    }));
    expect(seenFromTwo.prefs.some((p) => p.organizationId === one.org.id)).toBe(false);
    expect(seenFromTwo.pending.some((p) => p.organizationId === one.org.id)).toBe(false);
    const seenFromOne = await withOrgContext(one.org.id, (tx) => tx.teamActivityPending.count({}));
    expect(seenFromOne).toBeGreaterThan(0);
    // A write that names another organisation is refused by the policy.
    await expect(
      withOrgContext(two.org.id, (tx) =>
        tx.teamActivityPending.create({
          data: { organizationId: one.org.id, recipientMembershipId: one.mgmtA.membershipId, eventKey: "LEAD_CREATED", entityType: "Lead", entityId: "x", label: "x", path: "/x" },
        }),
      ),
    ).rejects.toThrow();
  });
});
