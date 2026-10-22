import { describe, expect, it } from "vitest";
import { ForbiddenError, ValidationError } from "../src/auth/errors";
import * as activityService from "../src/services/activityService";
import {
  listCalendar,
  MAX_CALENDAR_RANGE_DAYS,
} from "../src/services/calendarService";
import * as leadService from "../src/services/leadService";
import * as taskService from "../src/services/taskService";
import {
  createTestContext,
  createTestOrganization,
  getLeadStatusId,
} from "./helpers/fixtures";

/**
 * FIG-794 / B2.10: the calendar feed returns tasks by due date and calls and
 * meetings by scheduled time, scoped to the caller unless they may see the
 * team, flags overdue items, and never crosses an organization.
 */

const DAY = 86_400_000;
const from = new Date("2030-03-01T00:00:00Z");
const to = new Date("2030-04-01T00:00:00Z");
const range = { from: from.toISOString(), to: to.toISOString() };
const at = (day: number, hour = 9) =>
  new Date(Date.UTC(2030, 2, day, hour)).toISOString();

async function setup() {
  const org = await createTestOrganization("Calendar");
  const mgmt = await createTestContext(org.id, "MANAGEMENT", "cal.mgmt");
  const sales = await createTestContext(org.id, "SALES", "cal.sales");
  const otherSales = await createTestContext(org.id, "SALES", "cal.sales2");
  const leadStatusId = await getLeadStatusId(org.id);
  const { lead } = await leadService.createLead(sales, { leadStatusId });
  return { org, mgmt, sales, otherSales, lead };
}

describe("calendar feed", () => {
  it("returns the caller's tasks and calls/meetings in range, sorted, with the record link", async () => {
    const { sales, lead } = await setup();
    await taskService.createTask(sales, { title: "Send proposal", dueAt: at(10), leadId: lead.id });
    await taskService.createTask(sales, { title: "Out of range", dueAt: new Date("2030-05-01").toISOString() });
    await taskService.createTask(sales, { title: "No due date" });
    await activityService.createActivity(sales, {
      type: "MEETING",
      subject: "Kick-off",
      occurredAt: new Date(at(5, 14)),
      leadId: lead.id,
    });
    await activityService.createActivity(sales, {
      type: "NOTE",
      subject: "Not a calendar item",
      occurredAt: new Date(at(6)),
      leadId: lead.id,
    });

    const feed = await listCalendar(sales, range);
    expect(feed.items.map((i) => [i.kind, i.title])).toEqual([
      ["activity", "Kick-off"],
      ["task", "Send proposal"],
    ]);
    expect(feed.items[0]).toMatchObject({ type: "MEETING", link: { type: "Lead", id: lead.id } });
    expect(feed.items[1]).toMatchObject({ type: "TASK", status: "PENDING", overdue: false });
    expect(feed.truncated).toBe(false);
  });

  it("flags only open past-due tasks as overdue", async () => {
    const { sales } = await setup();
    const past = new Date(Date.now() - 3 * DAY);
    const open = await taskService.createTask(sales, { title: "Late", dueAt: past.toISOString() });
    const done = await taskService.createTask(sales, { title: "Late but done", dueAt: past.toISOString() });
    await taskService.createTask(sales, { title: "Future", dueAt: new Date(Date.now() + 3 * DAY).toISOString() });
    await taskService.updateTask(sales, done.id, { status: "COMPLETED" });

    const feed = await listCalendar(sales, {
      from: new Date(Date.now() - 10 * DAY).toISOString(),
      to: new Date(Date.now() + 10 * DAY).toISOString(),
    });
    const byTitle = Object.fromEntries(feed.items.map((i) => [i.title, i.overdue]));
    expect(byTitle).toEqual({ Late: true, "Late but done": false, Future: false });
    expect(feed.items.find((i) => i.id === open.id)?.overdue).toBe(true);
  });

  it("keeps a rep to their own items and refuses the team filter", async () => {
    const { sales, otherSales, mgmt } = await setup();
    await taskService.createTask(sales, { title: "Mine", dueAt: at(3) });
    await taskService.createTask(otherSales, { title: "Theirs", dueAt: at(3) });

    expect((await listCalendar(sales, range)).items.map((i) => i.title)).toEqual(["Mine"]);
    await expect(
      listCalendar(sales, { ...range, membershipId: otherSales.membershipId }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listCalendar(sales, { ...range, membershipId: "all" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    // Asking for yourself by id is fine.
    expect(
      (await listCalendar(sales, { ...range, membershipId: sales.membershipId })).items,
    ).toHaveLength(1);
    expect(mgmt.membershipId).not.toBe(sales.membershipId);
  });

  it("lets Management filter to one member or the whole team", async () => {
    const { sales, otherSales, mgmt } = await setup();
    await taskService.createTask(sales, { title: "Sales task", dueAt: at(3) });
    await taskService.createTask(otherSales, { title: "Other task", dueAt: at(4) });
    const { lead: otherLead } = await leadService.createLead(otherSales, {
      leadStatusId: await getLeadStatusId(mgmt.organizationId),
    });
    await activityService.createActivity(otherSales, {
      type: "CALL",
      subject: "Check-in",
      occurredAt: new Date(at(5)),
      leadId: otherLead.id,
    });

    const all = await listCalendar(mgmt, { ...range, membershipId: "all" });
    expect(all.items.map((i) => i.title)).toEqual(["Sales task", "Other task", "Check-in"]);

    const one = await listCalendar(mgmt, { ...range, membershipId: otherSales.membershipId });
    expect(one.items.map((i) => i.title)).toEqual(["Other task", "Check-in"]);
    expect(one.items.every((i) => i.assigneeMembershipId === otherSales.membershipId)).toBe(true);

    // Default is still just Management's own calendar.
    expect((await listCalendar(mgmt, range)).items).toEqual([]);
  });

  it("does not show another organization's items", async () => {
    const { mgmt } = await setup();
    const other = await createTestOrganization("Calendar Other");
    const otherMgmt = await createTestContext(other.id, "MANAGEMENT", "cal.other");
    await taskService.createTask(otherMgmt, { title: "Foreign", dueAt: at(3) });

    expect((await listCalendar(mgmt, { ...range, membershipId: "all" })).items).toEqual([]);
    await expect(
      listCalendar(mgmt, { ...range, membershipId: otherMgmt.membershipId }),
    ).rejects.toThrow();
  });

  it("validates the range", async () => {
    const { sales } = await setup();
    await expect(listCalendar(sales, { from: "nope", to: range.to })).rejects.toBeInstanceOf(ValidationError);
    await expect(listCalendar(sales, { from: range.to, to: range.from })).rejects.toBeInstanceOf(ValidationError);
    await expect(
      listCalendar(sales, {
        from: range.from,
        to: new Date(from.getTime() + (MAX_CALENDAR_RANGE_DAYS + 1) * DAY).toISOString(),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
