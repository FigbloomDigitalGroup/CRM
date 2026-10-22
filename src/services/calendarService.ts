import type { AuthContext } from "../auth/context";
import { hasPermission, requirePermission } from "../auth/context";
import { ValidationError } from "../auth/errors";
import { listCalendarActivities } from "../repositories/activities";
import { listTasks as listTasksRecords } from "../repositories/tasks";
import { assertEligibleTaskAssignee } from "./ownerEligibility";

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
};

export interface CalendarRequest {
  from: string;
  to: string;
  /** A member id, or "all" for the whole team. Defaults to the caller. */
  membershipId?: string;
}

function parseRange(request: CalendarRequest) {
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
 * Tasks (by due date) and calls/meetings (by scheduled time) in a window, for
 * month/week/day views (FIG-794, B2.10). Default is the caller's own items.
 * Another member, or "all", needs `tasks.view.all`; that member's calls and
 * meetings are only included when the caller can also see every lead and deal,
 * so a record the caller could not open never leaks through its activity.
 * Items carry record ids; opening one re-checks access on the record itself.
 */
export async function listCalendar(ctx: AuthContext, request: CalendarRequest) {
  const { from, to } = parseRange(request);
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
      }),
    ),
  ].sort((x, y) => x.start.localeCompare(y.start) || x.id.localeCompare(y.id));

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    items,
    truncated:
      tasks.length >= MAX_CALENDAR_ITEMS || activities.length >= MAX_CALENDAR_ITEMS,
  };
}
