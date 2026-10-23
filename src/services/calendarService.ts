import type { AuthContext } from "../auth/context";
import { hasPermission, requirePermission } from "../auth/context";
import { ValidationError } from "../auth/errors";
import { listCalendarActivities } from "../repositories/activities";
import { listTasks as listTasksRecords } from "../repositories/tasks";
import { localParts, startOfLocalDay, startOfNextLocalDay } from "../notifications/timeZone";
import { createActivity } from "./activityService";
import { memberTimeZone } from "./notificationDeliveryPolicy";
import { assertEligibleTaskAssignee, listTaskAssigneeCandidates } from "./ownerEligibility";
import { createTask, describeTaskLinks } from "./taskService";

/** Longest window one request may cover: a month view plus its leading/trailing days. */
export const MAX_CALENDAR_RANGE_DAYS = 62;
/** Per-source cap so one busy org cannot make a calendar request unbounded. */
export const MAX_CALENDAR_ITEMS = 1000;

export type CalendarItem = {
  kind: "task" | "activity";
  id: string;
  /** TASK for tasks; CALL or MEETING for activities. */
  type: string;
  title: string;
  /** Due date for a task, scheduled time for a call or meeting. */
  start: string;
  status: string | null;
  priority: string | null;
  /** Open and past due now -- derived, never stored (FIG-436). */
  overdue: boolean;
  assigneeMembershipId: string;
  assigneeName: string | null;
  link: { type: "Lead" | "Deal" | "Company" | "Contact"; id: string } | null;
  /** The date this item falls on in the viewer's own time zone (YYYY-MM-DD). */
  localDate: string;
  /** The time of day in the viewer's time zone (HH:MM); tasks without a time of day read 00:00 only when they are due at midnight. */
  localTime: string;
};

/** What a day view adds: the full detail, which the light month summaries leave out. */
export type CalendarDetail = CalendarItem & {
  description: string | null;
  /** The linked record's name when the viewer may open it; null otherwise. */
  linkLabel: string | null;
};

export type CalendarView = "month" | "week" | "day" | "list";

export interface DaySummary {
  date: string;
  taskCount: number;
  activityCount: number;
  overdueCount: number;
  /** A few titles to show in the cell. */
  preview: { kind: "task" | "activity"; title: string; overdue: boolean }[];
}

export interface CalendarRequest {
  /** An explicit window (ISO). Either this or `view` with `date`. */
  from?: string;
  to?: string;
  /** month, week (Monday to Sunday), day, or list (the next 30 days), around `date` in the viewer's time zone. */
  view?: CalendarView;
  /** The day the view is anchored on, YYYY-MM-DD in the viewer's time zone. Default: today. */
  date?: string;
  /** A member id, or "all" for the whole team. Defaults to the caller. */
  membershipId?: string;
}

/** The window of a view around a date, in the viewer's own time zone. */
function windowFor(view: CalendarView, date: string | undefined, timeZone: string, now: Date) {
  let anchor = now;
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
      throw new ValidationError("The calendar date is not valid.", [{ path: "date", message: "Use a date such as 2026-11-30." }]);
    }
    // Noon UTC is the same calendar day everywhere that matters; the start of day is then found in the viewer's zone.
    const [y, m, d] = date.split("-").map(Number) as [number, number, number];
    anchor = new Date(Date.UTC(y, m - 1, d, 12));
    const p = localParts(anchor, timeZone);
    if (p.year !== y || p.month !== m || p.day !== d) anchor = new Date(Date.UTC(y, m - 1, d, 9));
  }
  const dayStart = startOfLocalDay(anchor, timeZone);
  const p = localParts(dayStart, timeZone);
  const stepDay = (d: Date, n: number) => {
    let out = d;
    for (let i = 0; i < n; i += 1) out = startOfNextLocalDay(new Date(out.getTime() + 60_000), timeZone);
    return out;
  };
  const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  switch (view) {
    case "day":
      return { from: dayStart, to: startOfNextLocalDay(new Date(dayStart.getTime() + 60_000), timeZone) };
    case "week": {
      const back = (dow + 6) % 7; // days since Monday
      let from = dayStart;
      for (let i = 0; i < back; i += 1) from = startOfLocalDay(new Date(from.getTime() - 60_000), timeZone);
      return { from, to: stepDay(from, 7) };
    }
    case "list":
      return { from: dayStart, to: stepDay(dayStart, 30) };
    case "month": {
      const first = new Date(Date.UTC(p.year, p.month - 1, 1, 12));
      const from = startOfLocalDay(first, timeZone);
      const next = new Date(Date.UTC(p.year, p.month, 1, 12));
      return { from, to: startOfLocalDay(next, timeZone) };
    }
  }
}

function localDateOf(date: Date, timeZone: string): { localDate: string; localTime: string } {
  const p = localParts(date, timeZone);
  const two = (n: number) => String(n).padStart(2, "0");
  return { localDate: `${p.year}-${two(p.month)}-${two(p.day)}`, localTime: `${two(p.hour)}:${two(p.minute)}` };
}

function parseRange(request: CalendarRequest, timeZone: string) {
  if (request.view) {
    return windowFor(request.view, request.date, timeZone, new Date());
  }
  if (!request.from || !request.to) {
    throw new ValidationError("Give a from and to, or a view and date.", [{ path: "from", message: "from and to are required without a view." }]);
  }
  const from = new Date(request.from);
  const to = new Date(request.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new ValidationError("The calendar range is not a valid date.");
  }
  if (to <= from) {
    throw new ValidationError("The calendar range must end after it starts.");
  }
  if (to.getTime() - from.getTime() > MAX_CALENDAR_RANGE_DAYS * 86_400_000) {
    throw new ValidationError(
      `The calendar range can cover at most ${MAX_CALENDAR_RANGE_DAYS} days.`,
    );
  }
  return { from, to };
}

function linkOf(r: {
  dealId: string | null;
  leadId: string | null;
  companyId: string | null;
  contactId: string | null;
}): CalendarItem["link"] {
  if (r.dealId) return { type: "Deal", id: r.dealId };
  if (r.leadId) return { type: "Lead", id: r.leadId };
  if (r.companyId) return { type: "Company", id: r.companyId };
  if (r.contactId) return { type: "Contact", id: r.contactId };
  return null;
}

/**
 * Whether the caller may look at anyone else's calendar, and the explanation to
 * show when they may not (the filter is drawn disabled, with this reason).
 */
async function teamFilterFor(ctx: AuthContext) {
  const canChoose = hasPermission(ctx, "tasks.view.all");
  return {
    canChoose,
    reason: canChoose ? null : "You see your own calendar. Management can view the team calendar.",
    members: canChoose
      ? (await listTaskAssigneeCandidates(ctx.organizationId)).map((m) => ({ membershipId: m.membershipId, name: m.userName }))
      : [],
  };
}

/**
 * Tasks (by due date) and calls/meetings (by scheduled time) in a window, for
 * month/week/day/list views (FIG-794, FIG-1039, B2.10). Default is the caller's
 * own items. Another member, or "all", needs `tasks.view.all`; that member's
 * calls and meetings are only included when the caller can also see every lead
 * and deal, so a record the caller could not open never leaks through its
 * activity. Items carry record ids; opening one re-checks access on the record.
 *
 * Days are the viewer's own: every item says which date and time it falls on in
 * their time zone, so a meeting at 23:30 in Nairobi is on that evening's date
 * whatever zone the server runs in. The month view returns light per-day
 * summaries; week, day and list return the items, and a day also carries the
 * full detail.
 */
export async function listCalendar(ctx: AuthContext, request: CalendarRequest) {
  const timeZone = await memberTimeZone(ctx.organizationId, ctx.membershipId);
  const { from, to } = parseRange(request, timeZone);
  const requested = request.membershipId;
  const selfOnly = !requested || requested === ctx.membershipId;

  let memberId: string | undefined = ctx.membershipId;
  if (!selfOnly) {
    requirePermission(ctx, "tasks.view.all");
    memberId =
      requested === "all"
        ? undefined
        : (await assertEligibleTaskAssignee(ctx.organizationId, requested!)).id;
  }

  const canSeeTasks =
    hasPermission(ctx, "tasks.view.all") || hasPermission(ctx, "tasks.view.own");
  const canSeeOthersActivities =
    hasPermission(ctx, "leads.view.all") && hasPermission(ctx, "deals.view.all");
  const activityAuthor =
    memberId === ctx.membershipId || canSeeOthersActivities
      ? memberId
      : ctx.membershipId;

  const [tasks, activities] = await Promise.all([
    canSeeTasks
      ? listTasksRecords(ctx.organizationId, {
          assigneeMembershipId: memberId,
          dueAfter: from,
          dueBefore: to,
          take: MAX_CALENDAR_ITEMS,
        })
      : Promise.resolve([]),
    hasPermission(ctx, "activities.view")
      ? listCalendarActivities(ctx.organizationId, {
          from,
          to,
          authorMembershipId: activityAuthor,
          take: MAX_CALENDAR_ITEMS,
        })
      : Promise.resolve([]),
  ]);

  const now = new Date();
  const items: CalendarItem[] = [
    ...tasks.map(
      (t): CalendarItem => ({
        kind: "task",
        id: t.id,
        type: "TASK",
        title: t.title,
        start: t.dueAt!.toISOString(),
        status: t.status,
        priority: t.priority,
        overdue:
          (t.status === "PENDING" || t.status === "IN_PROGRESS") && t.dueAt! < now,
        assigneeMembershipId: t.assigneeMembershipId,
        assigneeName: t.assignee.user.name,
        link: linkOf(t),
        ...localDateOf(t.dueAt!, timeZone),
      }),
    ),
    ...activities.map(
      (a): CalendarItem => ({
        kind: "activity",
        id: a.id,
        type: a.type,
        title: a.subject ?? (a.type === "CALL" ? "Call" : "Meeting"),
        start: a.occurredAt.toISOString(),
        status: null,
        priority: null,
        overdue: false,
        assigneeMembershipId: a.authorMembershipId,
        assigneeName: a.author.user.name,
        link: linkOf(a),
        ...localDateOf(a.occurredAt, timeZone),
      }),
    ),
  ].sort((x, y) => x.start.localeCompare(y.start) || x.id.localeCompare(y.id));

  const truncated = tasks.length >= MAX_CALENDAR_ITEMS || activities.length >= MAX_CALENDAR_ITEMS;
  const base = {
    from: from.toISOString(),
    to: to.toISOString(),
    timeZone,
    view: request.view ?? null,
    truncated,
    teamFilter: await teamFilterFor(ctx),
    selected: requested === "all" ? "all" : (memberId ?? ctx.membershipId),
  };

  if (request.view === "month") {
    // Light summaries: counts and a few titles per day, no item bodies.
    const byDay = new Map<string, DaySummary>();
    for (const item of items) {
      const day = byDay.get(item.localDate) ?? { date: item.localDate, taskCount: 0, activityCount: 0, overdueCount: 0, preview: [] };
      if (item.kind === "task") day.taskCount += 1;
      else day.activityCount += 1;
      if (item.overdue) day.overdueCount += 1;
      if (day.preview.length < 3) day.preview.push({ kind: item.kind, title: item.title, overdue: item.overdue });
      byDay.set(item.localDate, day);
    }
    return { ...base, items: [] as CalendarItem[], days: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)) };
  }

  if (request.view === "day") {
    return { ...base, items: await withDetail(ctx, items, tasks, activities), days: undefined as DaySummary[] | undefined };
  }

  return { ...base, items, days: undefined as DaySummary[] | undefined };
}

/** A day view carries the full detail: descriptions and the name of each linked record the viewer may open. */
async function withDetail(
  ctx: AuthContext,
  items: CalendarItem[],
  tasks: { id: string; description: string | null; leadId: string | null; dealId: string | null; companyId: string | null; contactId: string | null }[],
  activities: { id: string; description: string | null; leadId: string | null; dealId: string | null; companyId: string | null; contactId: string | null }[],
): Promise<CalendarDetail[]> {
  const records = new Map<string, { description: string | null; ids: (typeof tasks)[number] }>();
  for (const t of tasks) records.set(`task:${t.id}`, { description: t.description, ids: t });
  for (const a of activities) records.set(`activity:${a.id}`, { description: a.description, ids: a });
  const links = await describeTaskLinks(
    ctx,
    items.map((i) => ({ ...(records.get(`${i.kind}:${i.id}`)?.ids ?? { leadId: null, dealId: null, companyId: null, contactId: null }), id: `${i.kind}:${i.id}` })),
  );
  return items.map((i) => ({
    ...i,
    description: records.get(`${i.kind}:${i.id}`)?.description ?? null,
    linkLabel: links[`${i.kind}:${i.id}`]?.label ?? null,
  }));
}

export interface CreateFromSlotInput {
  kind: "task" | "activity";
  title: string;
  /** The slot the person clicked: the due time of a task, the scheduled time of a call or meeting. */
  start: string;
  /** For an activity: CALL or MEETING. */
  type?: "CALL" | "MEETING";
  description?: string;
  /** A member id; only Management may choose someone else. */
  assigneeMembershipId?: string;
  link?: { type: "Lead" | "Deal" | "Company" | "Contact"; id: string };
}

/**
 * Creates a task or a scheduled call/meeting from an empty calendar slot, with
 * its time and an optional link to a record. It goes through the same services
 * as every other way of creating one, so the same permissions, scope checks and
 * archived-record rules apply.
 */
export async function createFromSlot(ctx: AuthContext, input: CreateFromSlotInput) {
  const start = new Date(input.start);
  if (Number.isNaN(start.getTime())) {
    throw new ValidationError("The start time is not valid.", [{ path: "start", message: "Use an ISO date and time." }]);
  }
  const ids = {
    leadId: input.link?.type === "Lead" ? input.link.id : undefined,
    dealId: input.link?.type === "Deal" ? input.link.id : undefined,
    companyId: input.link?.type === "Company" ? input.link.id : undefined,
    contactId: input.link?.type === "Contact" ? input.link.id : undefined,
  };
  if (input.kind === "task") {
    const task = await createTask(ctx, {
      title: input.title,
      description: input.description,
      dueAt: start.toISOString(),
      assigneeMembershipId: input.assigneeMembershipId,
      ...ids,
    });
    return { kind: "task" as const, id: task.id, start: start.toISOString() };
  }
  if (input.type !== "CALL" && input.type !== "MEETING") {
    throw new ValidationError("Choose a call or a meeting.", [{ path: "type", message: "Use CALL or MEETING." }]);
  }
  const title = input.title.trim();
  if (!title) throw new ValidationError("A title is required.", [{ path: "title", message: "A title is required." }]);
  if (!input.link) {
    throw new ValidationError("A call or meeting must be linked to a lead, deal, company or contact.", [{ path: "link", message: "Choose the record it is about." }]);
  }
  const activity = await createActivity(ctx, { type: input.type, subject: title, description: input.description, occurredAt: start, ...ids });
  return { kind: "activity" as const, id: activity.id, start: start.toISOString() };
}
