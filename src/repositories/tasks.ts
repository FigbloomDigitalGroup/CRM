import type { Prisma } from "@prisma/client";
import { withOrgContext } from "../db/orgScopedClient";
import { archivedWhere, type ArchiveMeta } from "../lib/archive";

export interface CreateTaskInput {
  organizationId: string;
  title: string;
  description?: string;
  /** Client requirements snapshot (FIG-1038). */
  requirements?: string;
  assigneeMembershipId: string;
  createdByMembershipId: string;
  dueAt?: Date;
  priority?: "LOW" | "MEDIUM" | "HIGH";
  companyId?: string;
  contactId?: string;
  leadId?: string;
  dealId?: string;
}

export async function createTask(input: CreateTaskInput) {
  return withOrgContext(input.organizationId, (tx) =>
    tx.task.create({
      data: {
        organizationId: input.organizationId,
        title: input.title,
        description: input.description,
        requirements: input.requirements,
        assigneeMembershipId: input.assigneeMembershipId,
        createdByMembershipId: input.createdByMembershipId,
        dueAt: input.dueAt,
        priority: input.priority,
        companyId: input.companyId,
        contactId: input.contactId,
        leadId: input.leadId,
        dealId: input.dealId,
      },
    }),
  );
}

/**
 * `completedAt` is set here only as a value the service layer derives from
 * a `status` transition, never passed through directly -- a task can't be
 * marked COMPLETED without stamping when.
 */
export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  requirements?: string | null;
  assigneeMembershipId?: string;
  dueAt?: Date | null;
  priority?: "LOW" | "MEDIUM" | "HIGH";
  status?: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  completedAt?: Date | null;
}

export async function updateTask(
  organizationId: string,
  taskId: string,
  input: UpdateTaskInput,
) {
  return withOrgContext(organizationId, (tx) =>
    tx.task.update({
      where: { id: taskId, organizationId },
      data: input,
    }),
  );
}

export async function getTaskById(organizationId: string, taskId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.task.findFirst({
      where: { id: taskId, organizationId },
    }),
  );
}

export interface ListTasksFilters {
  query?: string;
  assigneeMembershipId?: string;
  status?: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  priority?: "LOW" | "MEDIUM" | "HIGH";
  companyId?: string;
  contactId?: string;
  leadId?: string;
  dealId?: string;
  overdueOnly?: boolean;
  /** Archived tasks are hidden unless asked for (B2.16). */
  includeArchived?: boolean;
  /** The archived tab: only archived tasks. */
  archivedOnly?: boolean;
  /** Still open and not yet past due (no due date counts): the dashboard's "upcoming" list (FIG-789). */
  upcomingOnly?: boolean;
  /** "Due today," "due this week," etc. (FIG-443) -- independent of overdueOnly. */
  dueAfter?: Date;
  dueBefore?: Date;
  /** Caps the number of rows returned (e.g. global search's per-group limit, FIG-787) -- omit for the unbounded list views. */
  take?: number;
  /** Rows to skip before `take` -- set by the paged list functions (FIG-789), not by callers. */
  skip?: number;
}

/**
 * "Overdue" is derived at query time (past due, not completed/cancelled),
 * never stored (FIG-436). `overdueOnly` wins if a caller passes both it
 * and `dueAfter`/`dueBefore`, though no call site does.
 */
/** Shared by the list and count queries so a page and its total can never disagree (FIG-789). */
function tasksWhere(
  organizationId: string,
  filters: ListTasksFilters,
): Prisma.TaskWhereInput {
  return {
    organizationId,
    ...archivedWhere(filters),
    assigneeMembershipId: filters.assigneeMembershipId,
    status: filters.status,
    priority: filters.priority,
    companyId: filters.companyId,
    contactId: filters.contactId,
    leadId: filters.leadId,
    dealId: filters.dealId,
    ...(filters.dueAfter || filters.dueBefore
      ? {
          dueAt: {
            ...(filters.dueAfter ? { gte: filters.dueAfter } : {}),
            ...(filters.dueBefore ? { lt: filters.dueBefore } : {}),
          },
        }
      : {}),
    ...(filters.overdueOnly
      ? {
          dueAt: { lt: new Date() },
          status: { in: ["PENDING", "IN_PROGRESS"] },
        }
      : {}),
    ...(filters.upcomingOnly
      ? {
          AND: [
            { status: { in: ["PENDING", "IN_PROGRESS"] } },
            { OR: [{ dueAt: null }, { dueAt: { gte: new Date() } }] },
          ],
        }
      : {}),
    ...(filters.query
      ? {
          OR: [
            { title: { contains: filters.query, mode: "insensitive" } },
            { description: { contains: filters.query, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

export async function listTasks(
  organizationId: string,
  filters: ListTasksFilters = {},
) {
  return withOrgContext(organizationId, (tx) =>
    tx.task.findMany({
      where: tasksWhere(organizationId, filters),
      // Pulls the assignee's display name along so every role that can see a
      // task can see who it is assigned to (the member list itself is
      // Management-only). Nested relations are stripped in the service.
      include: { assignee: { include: { user: true } } },
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }, { id: "asc" }],
      take: filters.take,
      skip: filters.skip,
    }),
  );
}

/** Removes tasks by id -- only used to roll back a half-finished won-deal handoff (FIG-792). */
export async function deleteTasksByIds(organizationId: string, ids: string[]) {
  if (ids.length === 0) return { count: 0 };
  return withOrgContext(organizationId, (tx) =>
    tx.task.deleteMany({ where: { organizationId, id: { in: ids } } }),
  );
}

/** Rows matching `filters` across all pages (FIG-789) -- ignores `take`/`skip`. */
/** Tasks per assignee for the same filters a list would use (FIG-1043). */
export async function countTasksByAssignee(organizationId: string, filters: ListTasksFilters = {}) {
  return withOrgContext(organizationId, async (tx) => {
    const rows = await tx.task.groupBy({ by: ["assigneeMembershipId"], where: tasksWhere(organizationId, filters), _count: { _all: true } });
    return rows.map((r) => ({ assigneeMembershipId: r.assigneeMembershipId, count: r._count._all }));
  });
}

export async function countTasks(
  organizationId: string,
  filters: ListTasksFilters = {},
) {
  return withOrgContext(organizationId, (tx) =>
    tx.task.count({ where: tasksWhere(organizationId, filters) }),
  );
}

/** Sets `archivedAt`, who and why (FIG-1045, B2.16) -- never a hard delete. */
export async function archiveTask(organizationId: string, taskId: string, meta: ArchiveMeta = {}) {
  return withOrgContext(organizationId, (tx) =>
    tx.task.update({
      where: { id: taskId, organizationId },
      data: {
        archivedAt: new Date(),
        archivedByMembershipId: meta.membershipId ?? null,
        archiveReason: meta.reason ?? null,
      },
    }),
  );
}

export async function restoreTask(organizationId: string, taskId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.task.update({
      where: { id: taskId, organizationId },
      data: { archivedAt: null, archivedByMembershipId: null, archiveReason: null },
    }),
  );
}

// ---------------------------------------------------------------------------
// Due-state groups (FIG-1038, B2.09)
// ---------------------------------------------------------------------------

export type TaskGroupKey = "OVERDUE" | "TODAY" | "THIS_WEEK" | "LATER" | "NO_DATE" | "DONE";
export const TASK_GROUP_KEYS: readonly TaskGroupKey[] = ["OVERDUE", "TODAY", "THIS_WEEK", "LATER", "NO_DATE", "DONE"];

/** The moments that divide the groups, in the viewer's own time zone. */
export interface TaskGroupBounds {
  /** Start of today. */
  todayStart: Date;
  /** Start of tomorrow: the end of today. */
  tomorrowStart: Date;
  /** Start of the next week (Monday): the end of this week. */
  nextWeekStart: Date;
}

const OPEN = ["PENDING", "IN_PROGRESS"] as const;

/**
 * The one predicate for each group, used by both the counts and the rows, so a
 * group's count always equals what its list holds.
 *   Overdue   open, due before today
 *   Today     open, due today
 *   This week open, due after today and before next Monday
 *   Later     open, due from next Monday on
 *   No date   open, no due date
 *   Done      completed or cancelled
 */
export function taskGroupWhere(group: TaskGroupKey, bounds: TaskGroupBounds): Prisma.TaskWhereInput {
  switch (group) {
    case "OVERDUE":
      return { status: { in: [...OPEN] }, dueAt: { lt: bounds.todayStart } };
    case "TODAY":
      return { status: { in: [...OPEN] }, dueAt: { gte: bounds.todayStart, lt: bounds.tomorrowStart } };
    case "THIS_WEEK":
      return { status: { in: [...OPEN] }, dueAt: { gte: bounds.tomorrowStart, lt: bounds.nextWeekStart } };
    case "LATER":
      return { status: { in: [...OPEN] }, dueAt: { gte: bounds.nextWeekStart } };
    case "NO_DATE":
      return { status: { in: [...OPEN] }, dueAt: null };
    case "DONE":
      return { status: { in: ["COMPLETED", "CANCELLED"] } };
  }
}

/** Counts per group for one set of filters, in one pass of six cheap counts. */
export async function countTaskGroups(organizationId: string, filters: ListTasksFilters, bounds: TaskGroupBounds) {
  return withOrgContext(organizationId, async (tx) => {
    const base = tasksWhere(organizationId, { ...filters, overdueOnly: undefined, upcomingOnly: undefined, dueAfter: undefined, dueBefore: undefined, status: undefined });
    const counts = await Promise.all(TASK_GROUP_KEYS.map((g) => tx.task.count({ where: { AND: [base, taskGroupWhere(g, bounds)] } })));
    return Object.fromEntries(TASK_GROUP_KEYS.map((g, i) => [g, counts[i]!])) as Record<TaskGroupKey, number>;
  });
}

/** One page of one group, ordered the way the group reads: soonest due first, done most recent first. */
export async function listTaskGroup(
  organizationId: string,
  filters: ListTasksFilters,
  group: TaskGroupKey,
  bounds: TaskGroupBounds,
  paging: { skip: number; take: number },
) {
  return withOrgContext(organizationId, async (tx) => {
    const base = tasksWhere(organizationId, { ...filters, overdueOnly: undefined, upcomingOnly: undefined, dueAfter: undefined, dueBefore: undefined, status: undefined });
    const where: Prisma.TaskWhereInput = { AND: [base, taskGroupWhere(group, bounds)] };
    const orderBy: Prisma.TaskOrderByWithRelationInput[] =
      group === "DONE"
        ? [{ completedAt: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }, { id: "asc" }]
        : [{ dueAt: { sort: "asc", nulls: "last" } }, { priority: "desc" }, { createdAt: "desc" }, { id: "asc" }];
    const items = await tx.task.findMany({
      where,
      include: { assignee: { include: { user: true } } },
      orderBy,
      skip: paging.skip,
      take: paging.take,
    });
    return items;
  });
}

/** Attachments of several tasks at once (the technician's My work shows the files each task carries). */
export async function listAttachmentsForTasks(organizationId: string, taskIds: string[]) {
  if (taskIds.length === 0) return [];
  return withOrgContext(organizationId, (tx) =>
    tx.attachment.findMany({
      where: { organizationId, taskId: { in: taskIds }, deletedAt: null, file: { status: "READY" } },
      select: { id: true, taskId: true, title: true, file: { select: { id: true, name: true, sizeBytes: true, mimeType: true } } },
      orderBy: { createdAt: "asc" },
    }),
  );
}
