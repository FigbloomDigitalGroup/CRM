import { describe, expect, it } from "vitest";
import { ArchivedReadOnlyError, ForbiddenError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { createFromSlot, listCalendar } from "../src/services/calendarService";
import * as companyService from "../src/services/companyService";
import * as leadService from "../src/services/leadService";
import * as activityService from "../src/services/activityService";
import * as taskService from "../src/services/taskService";
import { createTestContext, createTestOrganization, getLeadStatusId } from "./helpers/fixtures";

async function setup(timeZone = "Africa/Nairobi") {
  const org = await createTestOrganization("CalV2");
  const management = await createTestContext(org.id, "MANAGEMENT");
  const sales = await createTestContext(org.id, "SALES", "sales");
  const other = await createTestContext(org.id, "SALES", "other");
  const finance = await createTestContext(org.id, "FINANCE");
  for (const ctx of [management, sales, other]) {
    const m = await adminDb.membership.findUniqueOrThrow({ where: { id: ctx.membershipId } });
    await adminDb.user.update({ where: { id: m.userId }, data: { timeZone } });
  }
  const { company } = await companyService.createCompany(management, { name: "Calendar Co" });
  return { org, management, sales, other, finance, company };
}

describe("calendar views and the viewer's time zone (FIG-1039, B2.10)", () => {
  it("a day belongs to the viewer: a meeting at 21:30 UTC is after midnight in Nairobi and sits on the next date", async () => {
    const { sales, company } = await setup("Africa/Nairobi");
    await activityService.createActivity(sales, { type: "MEETING", subject: "Late meeting", occurredAt: new Date("2026-11-10T21:30:00Z"), companyId: company.id });
    await activityService.createActivity(sales, { type: "CALL", subject: "Morning call", occurredAt: new Date("2026-11-10T05:00:00Z"), companyId: company.id });

    const day10 = await listCalendar(sales, { view: "day", date: "2026-11-10" });
    expect(day10.timeZone).toBe("Africa/Nairobi");
    expect(day10.items.map((i) => [i.title, i.localDate, i.localTime])).toEqual([["Morning call", "2026-11-10", "08:00"]]);
    const day11 = await listCalendar(sales, { view: "day", date: "2026-11-11" });
    expect(day11.items.map((i) => [i.title, i.localDate, i.localTime])).toEqual([["Late meeting", "2026-11-11", "00:30"]]);
    // The window itself is Nairobi midnight to Nairobi midnight.
    expect(day10.from).toBe("2026-11-09T21:00:00.000Z");
    expect(day10.to).toBe("2026-11-10T21:00:00.000Z");
  });

  it("a day is 25 hours long when the clocks go back and 23 when they go forward", async () => {
    const { sales, company } = await setup("America/New_York");
    const back = await listCalendar(sales, { view: "day", date: "2026-11-01" });
    expect((Date.parse(back.to) - Date.parse(back.from)) / 3_600_000).toBe(25);
    const forward = await listCalendar(sales, { view: "day", date: "2026-03-08" });
    expect((Date.parse(forward.to) - Date.parse(forward.from)) / 3_600_000).toBe(23);
    const normal = await listCalendar(sales, { view: "day", date: "2026-06-15" });
    expect((Date.parse(normal.to) - Date.parse(normal.from)) / 3_600_000).toBe(24);
    // A meeting at 23:30 New York time on the long day is still that day.
    await activityService.createActivity(sales, { type: "MEETING", subject: "Late", occurredAt: new Date("2026-11-02T04:30:00Z"), companyId: company.id });
    expect((await listCalendar(sales, { view: "day", date: "2026-11-01" })).items.map((i) => i.title)).toEqual(["Late"]);
  });

  it("the week runs Monday to Sunday, the month covers its own days, the list the next 30", async () => {
    const { sales } = await setup("Africa/Nairobi");
    // 2026-11-11 is a Wednesday.
    const week = await listCalendar(sales, { view: "week", date: "2026-11-11" });
    expect(week.from).toBe("2026-11-08T21:00:00.000Z"); // Monday 9 Nov, 00:00 Nairobi
    expect(week.to).toBe("2026-11-15T21:00:00.000Z"); // Monday 16 Nov, 00:00 Nairobi
    const sunday = await listCalendar(sales, { view: "week", date: "2026-11-15" });
    expect(sunday.from).toBe(week.from);

    const month = await listCalendar(sales, { view: "month", date: "2026-11-11" });
    expect(month.from).toBe("2026-10-31T21:00:00.000Z");
    expect(month.to).toBe("2026-11-30T21:00:00.000Z");

    const list = await listCalendar(sales, { view: "list", date: "2026-11-11" });
    expect((Date.parse(list.to) - Date.parse(list.from)) / 86_400_000).toBe(30);

    await expect(listCalendar(sales, { view: "day", date: "11/11/2026" })).rejects.toBeInstanceOf(ValidationError);
    await expect(listCalendar(sales, {})).rejects.toBeInstanceOf(ValidationError);
  });

  it("the month view returns light summaries per day, not the items; the day view returns full detail", async () => {
    const { sales, other, org } = await setup("Africa/Nairobi");
    const { lead } = await leadService.createLead(other, { leadStatusId: await getLeadStatusId(org.id) });
    const own = await leadService.createLead(sales, { leadStatusId: await getLeadStatusId(org.id) });
    for (let i = 0; i < 5; i += 1) await taskService.createTask(sales, { title: `Task ${i}`, dueAt: new Date(`2026-11-12T${String(i + 6).padStart(2, "0")}:00:00Z`).toISOString() });
    await taskService.createTask(sales, { title: "Linked", description: "Call back about the quote", dueAt: "2026-11-12T12:00:00Z", leadId: own.lead.id });
    await activityService.createActivity(sales, { type: "MEETING", subject: "Site visit", description: "Bring the survey form", occurredAt: new Date("2026-11-12T13:00:00Z"), leadId: own.lead.id });
    void lead;

    const month = await listCalendar(sales, { view: "month", date: "2026-11-12" });
    expect(month.items).toEqual([]);
    expect(month.days).toEqual([
      { date: "2026-11-12", taskCount: 6, activityCount: 1, overdueCount: month.days![0]!.overdueCount, preview: expect.any(Array) },
    ]);
    expect(month.days![0]!.preview).toHaveLength(3);
    expect(JSON.stringify(month)).not.toContain("Call back about the quote");

    const day = await listCalendar(sales, { view: "day", date: "2026-11-12" });
    expect(day.items).toHaveLength(7);
    const linked = day.items.find((i) => i.title === "Linked") as typeof day.items[number] & { description: string | null; linkLabel: string | null };
    expect(linked.description).toBe("Call back about the quote");
    expect(linked.link).toEqual({ type: "Lead", id: own.lead.id });
    expect(linked.linkLabel).toBeTruthy();
    const meeting = day.items.find((i) => i.title === "Site visit") as typeof linked;
    expect(meeting.description).toBe("Bring the survey form");
  });

  it("flags open past-due tasks as overdue in every view", async () => {
    const { sales } = await setup();
    const past = new Date(Date.now() - 3 * 86_400_000);
    const done = await taskService.createTask(sales, { title: "Done late", dueAt: past.toISOString() });
    await taskService.updateTask(sales, done.id, { status: "COMPLETED" });
    await taskService.createTask(sales, { title: "Still late", dueAt: past.toISOString() });
    const week = await listCalendar(sales, { from: new Date(Date.now() - 5 * 86_400_000).toISOString(), to: new Date().toISOString() });
    expect(Object.fromEntries(week.items.map((i) => [i.title, i.overdue]))).toEqual({ "Done late": false, "Still late": true });
  });
});

describe("team filter (FIG-1039, B2.10)", () => {
  it("is locked for Sales with the reason; Management can choose any member and sees the list to choose from", async () => {
    const { management, sales, other } = await setup();
    const range = { from: "2026-11-01T00:00:00Z", to: "2026-11-30T00:00:00Z" };
    const asSales = await listCalendar(sales, range);
    expect(asSales.teamFilter).toEqual({ canChoose: false, reason: "You see your own calendar. Management can view the team calendar.", members: [] });
    expect(asSales.selected).toBe(sales.membershipId);
    await expect(listCalendar(sales, { ...range, membershipId: other.membershipId })).rejects.toBeInstanceOf(ForbiddenError);

    const asManagement = await listCalendar(management, range);
    expect(asManagement.teamFilter.canChoose).toBe(true);
    expect(asManagement.teamFilter.reason).toBeNull();
    expect(asManagement.teamFilter.members.map((m) => m.membershipId)).toEqual(expect.arrayContaining([sales.membershipId, other.membershipId]));
    expect((await listCalendar(management, { ...range, membershipId: "all" })).selected).toBe("all");
    expect((await listCalendar(management, { ...range, membershipId: other.membershipId })).selected).toBe(other.membershipId);
  });
});

describe("create from a slot (FIG-1039, B2.10)", () => {
  it("creates a task due at the slot, linked to a record, and a call or meeting at that time", async () => {
    const { sales, org } = await setup();
    const { lead } = await leadService.createLead(sales, { leadStatusId: await getLeadStatusId(org.id) });

    const task = await createFromSlot(sales, { kind: "task", title: "Send brochure", start: "2026-11-12T09:00:00Z", link: { type: "Lead", id: lead.id } });
    const row = await adminDb.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(row).toMatchObject({ title: "Send brochure", leadId: lead.id, assigneeMembershipId: sales.membershipId });
    expect(row.dueAt?.toISOString()).toBe("2026-11-12T09:00:00.000Z");

    const meeting = await createFromSlot(sales, { kind: "activity", type: "MEETING", title: "Demo", start: "2026-11-12T11:00:00Z", description: "Zoom", link: { type: "Lead", id: lead.id } });
    const activity = await adminDb.activity.findUniqueOrThrow({ where: { id: meeting.id } });
    expect(activity).toMatchObject({ type: "MEETING", subject: "Demo", description: "Zoom", leadId: lead.id, authorMembershipId: sales.membershipId });
    expect(activity.occurredAt.toISOString()).toBe("2026-11-12T11:00:00.000Z");

    // Both show up on that day.
    const day = await listCalendar(sales, { view: "day", date: "2026-11-12" });
    expect(day.items.map((i) => i.title).sort()).toEqual(["Demo", "Send brochure"]);
  });

  it("follows the same rules as everywhere else: scope, assignment, archived records, validation, permissions", async () => {
    const { org, management, sales, other, finance } = await setup();
    const { lead: theirs } = await leadService.createLead(other, { leadStatusId: await getLeadStatusId(org.id) });
    await expect(createFromSlot(sales, { kind: "task", title: "x", start: "2026-11-12T09:00:00Z", link: { type: "Lead", id: theirs.id } })).rejects.toThrow();

    // Sales cannot hand a task to a colleague from the calendar; Management can.
    const forced = await createFromSlot(sales, { kind: "task", title: "Mine anyway", start: "2026-11-12T09:00:00Z", assigneeMembershipId: other.membershipId });
    expect((await adminDb.task.findUniqueOrThrow({ where: { id: forced.id } })).assigneeMembershipId).toBe(sales.membershipId);
    const assigned = await createFromSlot(management, { kind: "task", title: "For other", start: "2026-11-12T09:00:00Z", assigneeMembershipId: other.membershipId });
    expect((await adminDb.task.findUniqueOrThrow({ where: { id: assigned.id } })).assigneeMembershipId).toBe(other.membershipId);

    const { lead } = await leadService.createLead(sales, { leadStatusId: await getLeadStatusId(org.id) });
    await leadService.archiveLead(management, lead.id);
    await expect(createFromSlot(sales, { kind: "task", title: "x", start: "2026-11-12T09:00:00Z", link: { type: "Lead", id: lead.id } })).rejects.toBeInstanceOf(ArchivedReadOnlyError);

    await expect(createFromSlot(sales, { kind: "task", title: "x", start: "not a date" })).rejects.toBeInstanceOf(ValidationError);
    await expect(createFromSlot(sales, { kind: "activity", title: "x", start: "2026-11-12T09:00:00Z" })).rejects.toBeInstanceOf(ValidationError);
    await expect(createFromSlot(sales, { kind: "activity", type: "CALL", title: "  ", start: "2026-11-12T09:00:00Z" })).rejects.toBeInstanceOf(ValidationError);
    await expect(createFromSlot(sales, { kind: "activity", type: "CALL", title: "Unlinked", start: "2026-11-12T09:00:00Z" })).rejects.toThrow(/must be linked/);
    await expect(createFromSlot(finance, { kind: "task", title: "x", start: "2026-11-12T09:00:00Z" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("another organisation sees none of it", async () => {
    const one = await setup();
    const two = await setup();
    await createFromSlot(one.sales, { kind: "task", title: "Private", start: "2026-11-12T09:00:00Z" });
    const feed = await listCalendar(two.management, { view: "day", date: "2026-11-12", membershipId: "all" });
    expect(feed.items).toEqual([]);
  });
});
