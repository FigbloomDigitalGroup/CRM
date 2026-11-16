import { describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { sweepOrganization } from "../src/jobs/handlers/notificationSweep";
import { resolveFollowUpInstant } from "../src/lib/followUpTime";
import { createActivity as createActivityRecord } from "../src/repositories/activities";
import { createFromSlot, listCalendar } from "../src/services/calendarService";
import * as activityService from "../src/services/activityService";
import * as leadService from "../src/services/leadService";
import { backfillTaskLinks } from "../src/services/taskBackfill";
import * as taskService from "../src/services/taskService";
import { createTestContext, createTestOrganization, getLeadStatusId } from "./helpers/fixtures";

/**
 * P2-22 (FIG-1676): the Calendar and the Tasks page read one record. P2-23 (FIG-1677): a logged call, a call-to-action and the lead's Next follow-up
 * are one correlated set. P2-27 (FIG-1681): a follow-up is a date and a time. The rules are in docs/TASK_CORRELATION.md.
 */
async function setup(timeZone = "Africa/Nairobi") {
  const org = await createTestOrganization("Corr");
  const management = await createTestContext(org.id, "MANAGEMENT");
  const sales = await createTestContext(org.id, "SALES", "sales");
  const other = await createTestContext(org.id, "SALES", "other");
  for (const ctx of [management, sales, other]) {
    const m = await adminDb.membership.findUniqueOrThrow({ where: { id: ctx.membershipId } });
    await adminDb.user.update({ where: { id: m.userId }, data: { timeZone } });
  }
  const { lead } = await leadService.createLead(sales, { leadStatusId: await getLeadStatusId(org.id) });
  return { org, management, sales, other, lead };
}

const openFollowUps = (orgId: string, leadId: string) =>
  adminDb.task.findMany({ where: { organizationId: orgId, leadId, isFollowUp: true, archivedAt: null, status: { in: ["PENDING", "IN_PROGRESS"] } } });

describe("P2-22: Calendar items are Tasks (the root cause: calls and meetings were timeline activities)", () => {
  it("a call added from the Calendar is listed by the Tasks API, with its type, due time, owner and link", async () => {
    const { sales, lead } = await setup();
    const made = await createFromSlot(sales, { kind: "activity", type: "CALL", title: "Call Acme", start: "2026-11-20T12:00:00Z", link: { type: "Lead", id: lead.id } });

    const page = await taskService.listTasksPage(sales, { leadId: lead.id });
    expect(page.items.map((t) => t.id)).toEqual([made.id]);
    expect(page.items[0]).toMatchObject({ type: "CALL", title: "Call Acme", status: "PENDING", assigneeMembershipId: sales.membershipId, leadId: lead.id });
    expect(page.items[0]!.dueAt?.toISOString()).toBe("2026-11-20T12:00:00.000Z");

    const grouped = await taskService.listTasksGrouped(sales, { groups: ["LATER", "THIS_WEEK", "TODAY", "OVERDUE"] });
    const ids = grouped.groups.flatMap((g) => g.items.map((i) => i.id));
    expect(ids).toContain(made.id);
  });

  it("every type the Calendar can create is creatable and listable, and the type filter finds each", async () => {
    const { sales } = await setup();
    const ids: Record<string, string> = {};
    for (const [i, type] of (["TASK", "CALL", "MEETING", "EMAIL", "QUOTE", "VISIT"] as const).entries()) {
      ids[type] = (await taskService.createTask(sales, { title: `item ${type}`, type, dueAt: new Date(Date.UTC(2026, 10, 20, 8 + i)).toISOString() })).id;
    }
    for (const type of Object.keys(ids)) {
      const page = await taskService.listTasksPage(sales, { type: type as "TASK" });
      expect(page.items.map((t) => t.id)).toEqual([ids[type]]);
    }
    expect((await taskService.listTasksPage(sales)).items).toHaveLength(6);
  });

  it("a meeting appears once on the Calendar, at the same local time as on the Tasks page (15:00 in Nairobi)", async () => {
    const { sales } = await setup("Africa/Nairobi");
    const made = await createFromSlot(sales, { kind: "activity", type: "MEETING", title: "Demo", start: "2026-11-20T12:00:00Z" });
    const day = await listCalendar(sales, { view: "day", date: "2026-11-20" });
    expect(day.items.filter((i) => i.title === "Demo")).toHaveLength(1);
    expect(day.items[0]).toMatchObject({ id: made.id, kind: "task", type: "MEETING", localDate: "2026-11-20", localTime: "15:00", status: "PENDING" });
  });

  it("completing it in Tasks shows it done on the Calendar, and the other way round", async () => {
    const { sales } = await setup();
    const made = await createFromSlot(sales, { kind: "activity", type: "CALL", title: "Ring", start: "2026-11-20T12:00:00Z" });
    await taskService.updateTask(sales, made.id, { status: "COMPLETED" });
    const day = await listCalendar(sales, { view: "day", date: "2026-11-20" });
    expect(day.items.find((i) => i.id === made.id)).toMatchObject({ status: "COMPLETED", overdue: false });
    await taskService.updateTask(sales, made.id, { status: "PENDING" });
    expect((await taskService.getTask(sales, made.id)).status).toBe("PENDING");
  });

  it("a colleague's private task is invisible through both screens, and another organisation sees none of it", async () => {
    const { sales, other } = await setup();
    const made = await createFromSlot(sales, { kind: "activity", type: "CALL", title: "Private call", start: "2026-11-20T12:00:00Z" });
    expect((await taskService.listTasksPage(other)).items.map((t) => t.id)).not.toContain(made.id);
    expect((await listCalendar(other, { view: "day", date: "2026-11-20" })).items.map((i) => i.id)).not.toContain(made.id);
    const elsewhere = await setup();
    expect((await taskService.listTasksPage(elsewhere.sales)).items.map((t) => t.id)).not.toContain(made.id);
    expect((await listCalendar(elsewhere.sales, { view: "day", date: "2026-11-20" })).items).toEqual([]);
  });

  it("backfill: an old calendar activity (scheduled ahead) gets a task once; a call logged after it happened does not; a second run adds nothing", async () => {
    const { org, sales, lead } = await setup();
    const scheduled = await activityService.createActivity(sales, { type: "MEETING", subject: "Old scheduled demo", occurredAt: new Date(Date.now() + 5 * 86_400_000), leadId: lead.id });
    await activityService.createActivity(sales, { type: "CALL", subject: "Logged call", occurredAt: new Date(Date.now() - 3_600_000), leadId: lead.id });

    const dry = await backfillTaskLinks({ organizationId: org.id });
    expect(dry).toMatchObject({ dryRun: true, calendarActivities: { found: 1, created: 0 } });
    expect(await adminDb.task.count({ where: { organizationId: org.id } })).toBe(0);

    const first = await backfillTaskLinks({ organizationId: org.id, apply: true });
    expect(first.calendarActivities).toEqual({ found: 1, created: 1 });
    const task = await adminDb.task.findFirstOrThrow({ where: { organizationId: org.id, sourceActivityId: scheduled.id } });
    expect(task).toMatchObject({ type: "MEETING", title: "Old scheduled demo", leadId: lead.id, assigneeMembershipId: sales.membershipId });

    const second = await backfillTaskLinks({ organizationId: org.id, apply: true });
    expect(second.calendarActivities).toEqual({ found: 0, created: 0 });
    // Shown once: the activity is represented by its task.
    const cal = await listCalendar(sales, { from: new Date(Date.now() - 86_400_000).toISOString(), to: new Date(Date.now() + 10 * 86_400_000).toISOString() });
    expect(cal.items.filter((i) => i.title === "Old scheduled demo")).toHaveLength(1);
  });
});

describe("P2-23: the lead, its follow-up, its tasks and its timeline agree", () => {
  it("logging a call that happened is a done activity and no open task; its next step is the open follow-up task", async () => {
    const { org, sales, lead } = await setup();
    await activityService.createActivity(sales, { type: "CALL", subject: "Call", outcome: "Reached", leadId: lead.id });
    expect(await adminDb.task.count({ where: { organizationId: org.id, leadId: lead.id } })).toBe(0);

    const due = new Date(Date.now() + 2 * 86_400_000);
    const logged = await activityService.createActivity(sales, { type: "CALL", subject: "Call", leadId: lead.id, nextStep: { type: "QUOTE", title: "Send revised quote", dueAt: due.toISOString() } });
    const tasks = await openFollowUps(org.id, lead.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ title: "Send revised quote", type: "QUOTE", sourceActivityId: logged.id, assigneeMembershipId: sales.membershipId, isFollowUp: true });
    expect(tasks[0]!.dueAt?.toISOString()).toBe(due.toISOString());
    expect((await leadService.getLead(sales, lead.id)).nextFollowUpAt?.toISOString()).toBe(due.toISOString());
  });

  it("setting, moving and clearing the lead's Next follow-up creates, moves and cancels one task (never two)", async () => {
    const { org, sales, lead } = await setup();
    const d1 = new Date(Date.now() + 86_400_000);
    const d2 = new Date(Date.now() + 3 * 86_400_000);
    await leadService.updateLead(sales, lead.id, { nextFollowUpAt: d1 });
    await leadService.updateLead(sales, lead.id, { nextFollowUpAt: d1 }); // the same value again: nothing new
    expect(await openFollowUps(org.id, lead.id)).toHaveLength(1);
    await leadService.updateLead(sales, lead.id, { nextFollowUpAt: d2 });
    const moved = await openFollowUps(org.id, lead.id);
    expect(moved).toHaveLength(1);
    expect(moved[0]!.dueAt?.toISOString()).toBe(d2.toISOString());
    await leadService.updateLead(sales, lead.id, { nextFollowUpAt: null });
    expect(await openFollowUps(org.id, lead.id)).toHaveLength(0);
    expect((await adminDb.task.findMany({ where: { organizationId: org.id, leadId: lead.id } })).map((t) => t.status)).toEqual(["CANCELLED"]);
  });

  it("editing the follow-up task's time moves the lead's field, and completing it clears it and updates last contacted", async () => {
    const { org, sales, lead } = await setup();
    const d1 = new Date(Date.now() + 86_400_000);
    await leadService.updateLead(sales, lead.id, { nextFollowUpAt: d1 });
    const [task] = await openFollowUps(org.id, lead.id);
    const d2 = new Date(Date.now() + 4 * 86_400_000);
    await taskService.updateTask(sales, task!.id, { dueAt: d2.toISOString() });
    expect((await leadService.getLead(sales, lead.id)).nextFollowUpAt?.toISOString()).toBe(d2.toISOString());

    await taskService.updateTask(sales, task!.id, { status: "COMPLETED" });
    const after = await leadService.getLead(sales, lead.id);
    expect(after.nextFollowUpAt).toBeNull();
    expect(after.lastContactedAt).not.toBeNull();
    // Reopening puts it back.
    await taskService.updateTask(sales, task!.id, { status: "PENDING" });
    expect((await leadService.getLead(sales, lead.id)).nextFollowUpAt?.toISOString()).toBe(d2.toISOString());
  });

  it("archiving the follow-up task clears the lead's field; restoring puts it back", async () => {
    const { org, sales, lead } = await setup();
    const d1 = new Date(Date.now() + 86_400_000);
    await leadService.updateLead(sales, lead.id, { nextFollowUpAt: d1 });
    const [task] = await openFollowUps(org.id, lead.id);
    await taskService.archiveTask(sales, task!.id);
    expect((await leadService.getLead(sales, lead.id)).nextFollowUpAt).toBeNull();
    await taskService.restoreTask(sales, task!.id);
    expect((await leadService.getLead(sales, lead.id)).nextFollowUpAt?.toISOString()).toBe(d1.toISOString());
  });

  it("a scheduled call-to-action on a lead becomes its next step when it comes first, and stays a plain task when it does not", async () => {
    const { org, sales, lead } = await setup();
    const later = new Date(Date.now() + 5 * 86_400_000);
    const sooner = new Date(Date.now() + 2 * 86_400_000);
    await leadService.updateLead(sales, lead.id, { nextFollowUpAt: later });
    const call = await taskService.createTask(sales, { title: "Call them", type: "CALL", leadId: lead.id, dueAt: sooner.toISOString() });
    expect((await adminDb.task.findUniqueOrThrow({ where: { id: call.id } })).isFollowUp).toBe(true);
    expect((await leadService.getLead(sales, lead.id)).nextFollowUpAt?.toISOString()).toBe(sooner.toISOString());
    expect(await openFollowUps(org.id, lead.id)).toHaveLength(1);

    const email = await taskService.createTask(sales, { title: "Email them", type: "EMAIL", leadId: lead.id, dueAt: new Date(Date.now() + 9 * 86_400_000).toISOString() });
    expect((await adminDb.task.findUniqueOrThrow({ where: { id: email.id } })).isFollowUp).toBe(false);
    const plain = await taskService.createTask(sales, { title: "Plain", leadId: lead.id, dueAt: new Date(Date.now() + 86_400_000).toISOString() });
    expect((await adminDb.task.findUniqueOrThrow({ where: { id: plain.id } })).isFollowUp).toBe(false);
    expect((await leadService.getLead(sales, lead.id)).nextFollowUpAt?.toISOString()).toBe(sooner.toISOString());
  });

  it("a repeat cannot make a second open follow-up: the database refuses it", async () => {
    const { org, sales, lead } = await setup();
    await leadService.updateLead(sales, lead.id, { nextFollowUpAt: new Date(Date.now() + 86_400_000) });
    await expect(
      adminDb.task.create({ data: { organizationId: org.id, title: "dup", assigneeMembershipId: sales.membershipId, createdByMembershipId: sales.membershipId, leadId: lead.id, isFollowUp: true } }),
    ).rejects.toThrow();
  });

  it("if the task step fails, the logged activity is not saved either (one transaction)", async () => {
    const { org, sales, lead } = await setup();
    await expect(
      createActivityRecord({ organizationId: org.id, type: "CALL", authorMembershipId: sales.membershipId, leadId: lead.id }, async () => {
        throw new Error("task step failed");
      }),
    ).rejects.toThrow("task step failed");
    expect(await adminDb.activity.count({ where: { organizationId: org.id, leadId: lead.id } })).toBe(0);
  });

  it("the next step needs a lead and a real date; a colleague cannot move someone else's lead follow-up", async () => {
    const { sales, other, lead, org } = await setup();
    await expect(activityService.createActivity(sales, { type: "CALL", leadId: lead.id, nextStep: { type: "CALL", dueAt: "not a date" } })).rejects.toThrow(/valid date/);
    await expect(leadService.updateLead(other, lead.id, { nextFollowUpAt: new Date(Date.now() + 86_400_000) })).rejects.toThrow();
    expect(await openFollowUps(org.id, lead.id)).toHaveLength(0);
  });

  it("backfill: a lead with a follow-up date and no task gets one; a second run adds none", async () => {
    const { org, sales, lead } = await setup();
    const due = new Date(Date.now() + 86_400_000);
    await adminDb.lead.update({ where: { id: lead.id }, data: { nextFollowUpAt: due } });
    const dry = await backfillTaskLinks({ organizationId: org.id });
    expect(dry.leadFollowUps).toMatchObject({ found: 1, created: 0 });
    expect(await openFollowUps(org.id, lead.id)).toHaveLength(0);
    const run = await backfillTaskLinks({ organizationId: org.id, apply: true });
    expect(run.leadFollowUps).toMatchObject({ found: 1, created: 1 });
    const [task] = await openFollowUps(org.id, lead.id);
    expect(task).toMatchObject({ assigneeMembershipId: sales.membershipId, type: "TASK" });
    expect(task!.dueAt?.toISOString()).toBe(due.toISOString());
    expect((await backfillTaskLinks({ organizationId: org.id, apply: true })).leadFollowUps).toMatchObject({ found: 0, created: 0 });
  });
});

describe("P2-27: a follow-up is a date and a time", () => {
  it("a date-only value from an old client is the default time (09:00) in the person's own zone, not midnight UTC", async () => {
    const { sales, lead } = await setup("Africa/Nairobi");
    await leadService.updateLead(sales, lead.id, { nextFollowUpAt: "2026-11-20" });
    expect((await leadService.getLead(sales, lead.id)).nextFollowUpAt?.toISOString()).toBe("2026-11-20T06:00:00.000Z");
    // A full date and time is stored as sent.
    await leadService.updateLead(sales, lead.id, { nextFollowUpAt: "2026-11-20T12:30:00Z" });
    expect((await leadService.getLead(sales, lead.id)).nextFollowUpAt?.toISOString()).toBe("2026-11-20T12:30:00.000Z");
  });

  it("date-only input resolves across a day boundary and daylight saving", () => {
    expect(resolveFollowUpInstant("2026-11-20", "Africa/Nairobi")?.toISOString()).toBe("2026-11-20T06:00:00.000Z");
    // New York: 09:00 EST (UTC-5) before the change, 09:00 EDT (UTC-4) after it on 8 March 2026.
    expect(resolveFollowUpInstant("2026-03-07", "America/New_York")?.toISOString()).toBe("2026-03-07T14:00:00.000Z");
    expect(resolveFollowUpInstant("2026-03-09", "America/New_York")?.toISOString()).toBe("2026-03-09T13:00:00.000Z");
    expect(resolveFollowUpInstant("2026-03-09T20:15:00Z", "America/New_York")?.toISOString()).toBe("2026-03-09T20:15:00.000Z");
    expect(resolveFollowUpInstant(null, "UTC")).toBeNull();
    expect(resolveFollowUpInstant(undefined, "UTC")).toBeUndefined();
    expect(resolveFollowUpInstant("garbage", "UTC")).toBeUndefined();
  });

  it("the reminder goes out at the follow-up time, not at the start of the day, and overdue counts from the time", async () => {
    const { org, sales } = await setup("UTC");
    const now = new Date("2026-11-20T10:00:00Z");
    const soon = await taskService.createTask(sales, { title: "In five minutes", dueAt: new Date("2026-11-20T10:05:00Z").toISOString() });
    await taskService.createTask(sales, { title: "Tonight", dueAt: new Date("2026-11-20T20:00:00Z").toISOString() });
    await taskService.createTask(sales, { title: "Ten minutes ago", dueAt: new Date("2026-11-20T09:50:00Z").toISOString() });

    const result = await sweepOrganization(org.id, { now });
    expect(result.due).toBe(1); // only the task whose time falls in this sweep window
    expect(result.overdue).toBe(1); // overdue from 09:50, not from the end of the day
    expect(soon.id).toBeTruthy();
  });
});
