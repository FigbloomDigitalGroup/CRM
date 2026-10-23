import type { AuthContext } from "../auth/context";
import {
  deny,
  hasPermission,
  requirePermission,
} from "../auth/context";
import { ForbiddenError, NotFoundError, ValidationError } from "../auth/errors";
import { assertRecordVisible } from "../auth/visibility";
import { assertWritable, cleanArchiveReason, canRestoreRecord } from "../lib/archive";
import { recordAuditEvent } from "../repositories/auditEvents";
import {
  createTask as createTaskRecord,
  archiveTask as archiveTaskRecord,
  restoreTask as restoreTaskRecord,
  getTaskById,
  countTaskGroups,
  countTasks as countTasksRecords,
  listAttachmentsForTasks,
  listTaskGroup,
  TASK_GROUP_KEYS,
  type TaskGroupBounds,
  type TaskGroupKey,
  listTasks as listTasksRecords,
  updateTask as updateTaskRecord,
  type CreateTaskInput,
  type ListTasksFilters,
} from "../repositories/tasks";
import { getCompany } from "./companyService";
import { getContact } from "./contactService";
import { getDeal } from "./dealService";
import { getLead } from "./leadService";
import {
  assertEligibleTaskAssignee,
  listTaskAssigneeCandidates,
} from "./ownerEligibility";
import { rescoreCompanyQuietly } from "./scoreEngine";
import { invalidateSignals } from "./signalService";
import { assertCanAccessLinkedRecords } from "./recordAccess";
import { buildPage, resolvePaging, type PageRequest } from "../lib/pagination";
import { localParts, startOfLocalDay, startOfNextLocalDay } from "../notifications/timeZone";
import { memberTimeZone } from "./notificationDeliveryPolicy";

function parseDueDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError("The due date is not a valid date.");
  }
  return date;
}

function cleanTitle(title: string | undefined): string | undefined {
  if (title === undefined) return undefined;
  const trimmed = title.trim();
  if (!trimmed) throw new ValidationError("A task needs a title.");
  return trimmed;
}

/** Task rows leave the service with the assignee's name flattened in, never the nested membership/user records. */
function withAssigneeName<
  T extends { assignee?: { user: { name: string } } | null },
>(task: T) {
  const { assignee, ...rest } = task;
  return { ...rest, assigneeName: assignee?.user.name ?? null };
}

const MAX_REQUIREMENTS = 5000;

function cleanRequirements(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length > MAX_REQUIREMENTS) {
    throw new ValidationError(`The requirements are too long (at most ${MAX_REQUIREMENTS} characters).`, [{ path: "requirements", message: `At most ${MAX_REQUIREMENTS} characters.` }]);
  }
  return trimmed || null;
}

export type CreateTaskServiceInput = Omit<
  CreateTaskInput,
  "organizationId" | "createdByMembershipId" | "assigneeMembershipId" | "dueAt"
> & { assigneeMembershipId?: string; dueAt?: string };

async function resolveAssignee(ctx: AuthContext, requested?: string) {
  if (hasPermission(ctx, "tasks.assign.any")) {
    if (!requested || requested === ctx.membershipId) {
      return ctx.membershipId;
    }
    const target = await assertEligibleTaskAssignee(
      ctx.organizationId,
      requested,
    );
    return target.id;
  }

  // tasks.assign.own means "assign to self" -- never trust a
  // client-supplied assignee here, same as leadService.assignLead.
  requirePermission(ctx, "tasks.assign.own");
  return ctx.membershipId;
}

export async function createTask(
  ctx: AuthContext,
  input: CreateTaskServiceInput,
) {
  requirePermission(ctx, "tasks.create");
  const title = cleanTitle(input.title);
  const dueAt = parseDueDate(input.dueAt);
  await assertCanAccessLinkedRecords(ctx, input, { requireWritable: true });
  const assigneeMembershipId = await resolveAssignee(
    ctx,
    input.assigneeMembershipId,
  );

  const task = await createTaskRecord({
    ...input,
    title: title!,
    requirements: cleanRequirements(input.requirements) ?? undefined,
    organizationId: ctx.organizationId,
    createdByMembershipId: ctx.membershipId,
    assigneeMembershipId,
    dueAt: dueAt ?? undefined,
  });
  await rescoreCompanyQuietly(ctx.organizationId, task.companyId);
  await invalidateSignals(ctx.organizationId);
  return task;
}

async function loadVisibleTask(ctx: AuthContext, taskId: string) {
  const task = await getTaskById(ctx.organizationId, taskId);
  if (!task) {
    throw new NotFoundError("Task", taskId);
  }
  assertRecordVisible(ctx, "tasks", "Task", taskId, {
    ownerMembershipId: task.assigneeMembershipId,
  });
  return task;
}

export async function getTask(ctx: AuthContext, taskId: string) {
  return loadVisibleTask(ctx, taskId);
}

/**
 * Same "own filter is server-enforced, never client-trusted" rule as
 * leadService.listLeads/dealService.listDeals.
 */
function scopeTaskFilters(
  ctx: AuthContext,
  filters: ListTasksFilters,
): ListTasksFilters {
  if (hasPermission(ctx, "tasks.view.all")) return filters;
  requirePermission(ctx, "tasks.view.own");
  return { ...filters, assigneeMembershipId: ctx.membershipId };
}

/** Every matching task, unpaged -- internal use; list screens and the API use `listTasksPage` (FIG-789). */
export async function listTasks(
  ctx: AuthContext,
  filters: ListTasksFilters = {},
) {
  return (
    await listTasksRecords(ctx.organizationId, scopeTaskFilters(ctx, filters))
  ).map(withAssigneeName);
}

/** One page of tasks plus the total, with the same own/all scoping as `listTasks` (FIG-789). */
export async function listTasksPage(
  ctx: AuthContext,
  filters: ListTasksFilters = {},
  request: PageRequest = {},
) {
  const scoped = scopeTaskFilters(ctx, filters);
  const paging = resolvePaging(request);
  const [tasks, total] = await Promise.all([
    listTasksRecords(ctx.organizationId, {
      ...scoped,
      take: paging.take,
      skip: paging.skip,
    }),
    countTasksRecords(ctx.organizationId, scoped),
  ]);
  return buildPage(tasks.map(withAssigneeName), total, paging);
}

/** How many tasks this caller can see for `filters` -- a COUNT, never a row fetch (FIG-789). */
export async function countTasks(
  ctx: AuthContext,
  filters: ListTasksFilters = {},
) {
  return countTasksRecords(ctx.organizationId, scopeTaskFilters(ctx, filters));
}

/** Who a task can be handed to: active members whose role can view tasks. Needs `tasks.assign.any`. */
export async function listAssignableTaskAssignees(ctx: AuthContext) {
  requirePermission(ctx, "tasks.assign.any");
  return listTaskAssigneeCandidates(ctx.organizationId);
}

/**
 * What the signed-in member may do with one task, for the UI. Same rule
 * `updateTask` enforces: the assignee, the creator, or anyone with
 * `tasks.assign.any` can change it. Reassigning is `tasks.assign.any` only.
 */
export function taskCapabilities(
  ctx: AuthContext,
  task: {
    assigneeMembershipId: string;
    createdByMembershipId: string;
    status: string;
  },
) {
  const canManage = canManageTask(ctx, task);
  return {
    canManage,
    canReassign: canManage && hasPermission(ctx, "tasks.assign.any"),
    isClosed: task.status === "COMPLETED" || task.status === "CANCELLED",
  };
}

export type TaskLink = {
  type: "Lead" | "Deal" | "Company" | "Contact";
  id: string;
  /** Null when the viewer is not allowed to open the linked record. */
  label: string | null;
};

/**
 * "Linked to" for each task. A task can point at a record its viewer may
 * not be able to open (e.g. Management assigns Delivery a task on a lead).
 * Each link is resolved through the parent's own view check, so a label is
 * only returned for records the viewer can actually see; otherwise the
 * type is shown with no name or link.
 */
export async function describeTaskLinks(
  ctx: AuthContext,
  tasks: {
    id: string;
    leadId: string | null;
    dealId: string | null;
    companyId: string | null;
    contactId: string | null;
  }[],
): Promise<Record<string, TaskLink>> {
  const cache = new Map<string, Promise<string | null>>();
  const labelFor = (key: string, load: () => Promise<string | null>) => {
    let p = cache.get(key);
    if (!p) {
      p = load().catch((err) => {
        if (err instanceof ForbiddenError || err instanceof NotFoundError) {
          return null;
        }
        throw err;
      });
      cache.set(key, p);
    }
    return p;
  };

  const entries = await Promise.all(
    tasks.map(async (t): Promise<[string, TaskLink] | null> => {
      if (t.dealId) {
        const label = await labelFor(`deal:${t.dealId}`, async () => {
          const deal = await getDeal(ctx, t.dealId!);
          return deal.company.name;
        });
        return [t.id, { type: "Deal", id: t.dealId, label }];
      }
      if (t.leadId) {
        const label = await labelFor(`lead:${t.leadId}`, async () => {
          const lead = await getLead(ctx, t.leadId!);
          return lead.company?.name ?? lead.contact?.firstName ?? "Untitled lead";
        });
        return [t.id, { type: "Lead", id: t.leadId, label }];
      }
      if (t.companyId) {
        const label = await labelFor(`company:${t.companyId}`, async () => {
          const company = await getCompany(ctx, t.companyId!);
          return company.name;
        });
        return [t.id, { type: "Company", id: t.companyId, label }];
      }
      if (t.contactId) {
        const label = await labelFor(`contact:${t.contactId}`, async () => {
          const contact = await getContact(ctx, t.contactId!);
          return `${contact.firstName} ${contact.lastName ?? ""}`.trim();
        });
        return [t.id, { type: "Contact", id: t.contactId, label }];
      }
      return null;
    }),
  );
  return Object.fromEntries(entries.filter((e): e is [string, TaskLink] => e !== null));
}

/**
 * There's no dedicated `tasks.edit` permission (only create/assign/view;
 * the permission matrix is still provisional, see
 * IMPLEMENTATION_NOTES.md), so a task can be updated by its assignee, its
 * creator, or anyone holding `tasks.assign.any`. Still requires the
 * caller to be able to *view* the task at all, checked first.
 */
function canManageTask(
  ctx: AuthContext,
  task: { assigneeMembershipId: string; createdByMembershipId: string },
) {
  return (
    hasPermission(ctx, "tasks.assign.any") ||
    task.assigneeMembershipId === ctx.membershipId ||
    task.createdByMembershipId === ctx.membershipId
  );
}

export interface UpdateTaskServiceInput {
  title?: string;
  description?: string | null;
  /** Client requirements snapshot (FIG-1038). */
  requirements?: string | null;
  assigneeMembershipId?: string;
  dueAt?: string | null;
  priority?: "LOW" | "MEDIUM" | "HIGH";
  status?: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
}

export async function updateTask(
  ctx: AuthContext,
  taskId: string,
  input: UpdateTaskServiceInput,
) {
  const task = await loadVisibleTask(ctx, taskId);
  if (!canManageTask(ctx, task)) {
    throw deny(ctx, "tasks.assign.any, or being this task's assignee/creator", [
      "tasks.assign.any",
    ]);
  }
  assertWritable(ctx, "task", task);

  // A finished task is a record of what happened: reopen it (status back to
  // Pending / In progress) before changing its details.
  const isClosed = task.status === "COMPLETED" || task.status === "CANCELLED";
  const reopening =
    input.status === "PENDING" || input.status === "IN_PROGRESS";
  const touchesDetails =
    input.title !== undefined ||
    input.description !== undefined ||
    input.dueAt !== undefined ||
    input.priority !== undefined ||
    (input.assigneeMembershipId !== undefined &&
      input.assigneeMembershipId !== task.assigneeMembershipId);
  if (isClosed && touchesDetails && !reopening) {
    throw new ValidationError(
      "This task is closed. Reopen it before changing its details.",
    );
  }

  const title = cleanTitle(input.title);
  const dueAt = parseDueDate(input.dueAt);

  let assigneeMembershipId: string | undefined;
  if (
    input.assigneeMembershipId !== undefined &&
    input.assigneeMembershipId !== task.assigneeMembershipId
  ) {
    requirePermission(ctx, "tasks.assign.any");
    const target = await assertEligibleTaskAssignee(
      ctx.organizationId,
      input.assigneeMembershipId,
    );
    assigneeMembershipId = target.id;
  }

  const statusChanged =
    input.status !== undefined && input.status !== task.status;

  const updatedTask = await updateTaskRecord(ctx.organizationId, taskId, {
    title,
    description: input.description,
    requirements: cleanRequirements(input.requirements),
    assigneeMembershipId,
    dueAt,
    priority: input.priority,
    status: input.status,
    // Stamped only when the status actually changes, so saving an
    // already-completed task never moves its completion time.
    completedAt: statusChanged
      ? input.status === "COMPLETED"
        ? new Date()
        : null
      : undefined,
  });
  await invalidateSignals(ctx.organizationId);
  return updatedTask;
}

/** Soft-delete (FIG-1045, B2.16): the assignee, the creator or Management; read-only until restored. */
export async function archiveTask(ctx: AuthContext, taskId: string, input: { reason?: string | null } = {}) {
  const task = await loadVisibleTask(ctx, taskId);
  if (!canRestoreRecord(ctx, "task", task)) {
    throw deny(ctx, "tasks.assign.any, or being this task's assignee/creator", ["tasks.assign.any"]);
  }
  if (task.archivedAt) throw new ValidationError("This task is already archived.");
  const reason = cleanArchiveReason(input.reason);
  const archived = await archiveTaskRecord(ctx.organizationId, taskId, { membershipId: ctx.membershipId, reason });
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "task.archived",
    entityType: "Task",
    entityId: taskId,
    metadata: reason ? { reason } : undefined,
  });
  return archived;
}

export async function restoreTask(ctx: AuthContext, taskId: string) {
  const task = await loadVisibleTask(ctx, taskId);
  if (!canRestoreRecord(ctx, "task", task)) {
    throw deny(ctx, "tasks.assign.any, or being this task's assignee/creator", ["tasks.assign.any"]);
  }
  if (!task.archivedAt) throw new ValidationError("This task is not archived.");
  const restored = await restoreTaskRecord(ctx.organizationId, taskId);
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "task.restored",
    entityType: "Task",
    entityId: taskId,
  });
  return restored;
}

// ---------------------------------------------------------------------------
// Tasks grouped by due state (FIG-1038, B2.09)
// ---------------------------------------------------------------------------

export const TASK_GROUP_LABELS: Record<TaskGroupKey, string> = {
  OVERDUE: "Overdue",
  TODAY: "Today",
  THIS_WEEK: "This week",
  LATER: "Later",
  NO_DATE: "No date",
  DONE: "Done",
};

export const DEFAULT_GROUP_PAGE_SIZE = 10;

/**
 * Where the groups divide, in the viewer's own time zone: today, tomorrow and
 * the start of next week (Monday). "Today" is the viewer's wall-clock day, so a
 * task due at 23:30 in Nairobi is today for a Nairobi user.
 */
export async function taskGroupBounds(ctx: AuthContext, now = new Date()): Promise<TaskGroupBounds & { timeZone: string }> {
  const timeZone = await memberTimeZone(ctx.organizationId, ctx.membershipId);
  const todayStart = startOfLocalDay(now, timeZone);
  const tomorrowStart = startOfNextLocalDay(now, timeZone);
  const p = localParts(now, timeZone);
  const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(); // 0 Sunday .. 6 Saturday
  const daysToNextMonday = (8 - weekday) % 7 || 7;
  let nextWeekStart = tomorrowStart;
  for (let i = 1; i < daysToNextMonday; i += 1) nextWeekStart = startOfNextLocalDay(new Date(nextWeekStart.getTime() + 60_000), timeZone);
  return { todayStart, tomorrowStart, nextWeekStart, timeZone };
}

function isGroupKey(value: string): value is TaskGroupKey {
  return (TASK_GROUP_KEYS as readonly string[]).includes(value);
}

async function decorate(ctx: AuthContext, rows: Awaited<ReturnType<typeof listTaskGroup>>) {
  const links = await describeTaskLinks(ctx, rows);
  return rows.map(withAssigneeName).map((task) => ({
    ...task,
    link: links[task.id] ?? null,
    // Someone else's task can be read but not changed (B2.09).
    readOnly: !canManageTask(ctx, task),
  }));
}

export interface GroupedTasksQuery {
  filters?: ListTasksFilters;
  /** Rows per group on the first page. Default 10. */
  pageSize?: number;
  /** Only these groups. */
  groups?: string[];
}

/**
 * Tasks in due-state groups with a count per group and the first page of each.
 * A group's count and its rows come from one predicate, so they always agree.
 * Done is returned collapsed (its count, no rows) until it is asked for.
 */
export async function listTasksGrouped(ctx: AuthContext, query: GroupedTasksQuery = {}) {
  const scoped = scopeTaskFilters(ctx, query.filters ?? {});
  const bounds = await taskGroupBounds(ctx);
  const wanted = (query.groups?.length ? query.groups : [...TASK_GROUP_KEYS]).filter(isGroupKey);
  const counts = await countTaskGroups(ctx.organizationId, scoped, bounds);
  const paging = resolvePaging({ page: 1, pageSize: query.pageSize ?? DEFAULT_GROUP_PAGE_SIZE });
  const groups = await Promise.all(
    TASK_GROUP_KEYS.filter((g) => wanted.includes(g)).map(async (key) => {
      const collapsed = key === "DONE" && !query.groups?.includes("DONE");
      const rows = collapsed ? [] : await listTaskGroup(ctx.organizationId, scoped, key, bounds, paging);
      const page = buildPage(await decorate(ctx, rows), counts[key], paging);
      return { key, label: TASK_GROUP_LABELS[key], count: counts[key], collapsed, ...page };
    }),
  );
  return { timeZone: bounds.timeZone, counts, groups };
}

/** One page of one group (server-side paging per group). */
export async function listTaskGroupPage(ctx: AuthContext, group: string, filters: ListTasksFilters = {}, request: PageRequest = {}) {
  if (!isGroupKey(group)) {
    throw new ValidationError("Unknown task group.", [{ path: "group", message: `Use one of ${TASK_GROUP_KEYS.join(", ")}.` }]);
  }
  const scoped = scopeTaskFilters(ctx, filters);
  const bounds = await taskGroupBounds(ctx);
  const paging = resolvePaging({ pageSize: DEFAULT_GROUP_PAGE_SIZE, ...request });
  const [counts, rows] = await Promise.all([
    countTaskGroups(ctx.organizationId, scoped, bounds),
    listTaskGroup(ctx.organizationId, scoped, group, bounds, paging),
  ]);
  return { key: group, label: TASK_GROUP_LABELS[group], count: counts[group], ...buildPage(await decorate(ctx, rows), counts[group], paging) };
}

// ---------------------------------------------------------------------------
// Restricted Technical: My work (FIG-1038, T1, D3)
// ---------------------------------------------------------------------------

/**
 * A technician's tasks with the requirements and files each carries, grouped
 * like any task list. Nothing else about the work leaks: no linked record, no
 * deal, no contact, no value. The requirements text is a snapshot taken when
 * the task was created, so it stays as written whatever happens to the deal.
 */
export async function getMyWork(ctx: AuthContext, query: { pageSize?: number; groups?: string[] } = {}) {
  requirePermission(ctx, "mywork.view");
  const bounds = await taskGroupBounds(ctx);
  const filters: ListTasksFilters = { assigneeMembershipId: ctx.membershipId };
  const wanted = (query.groups?.length ? query.groups : [...TASK_GROUP_KEYS]).filter(isGroupKey);
  const counts = await countTaskGroups(ctx.organizationId, filters, bounds);
  const paging = resolvePaging({ page: 1, pageSize: query.pageSize ?? DEFAULT_GROUP_PAGE_SIZE });

  const groups = await Promise.all(
    TASK_GROUP_KEYS.filter((g) => wanted.includes(g)).map(async (key) => {
      const collapsed = key === "DONE" && !query.groups?.includes("DONE");
      const rows = collapsed ? [] : await listTaskGroup(ctx.organizationId, filters, key, bounds, paging);
      const files = await listAttachmentsForTasks(ctx.organizationId, rows.map((r) => r.id));
      const items = rows.map((task) => ({
        id: task.id,
        title: task.title,
        description: task.description,
        requirements: task.requirements,
        status: task.status,
        priority: task.priority,
        dueAt: task.dueAt,
        completedAt: task.completedAt,
        files: files.filter((f) => f.taskId === task.id).map((f) => ({ attachmentId: f.id, title: f.title, fileId: f.file.id, name: f.file.name, sizeBytes: f.file.sizeBytes, mimeType: f.file.mimeType })),
      }));
      return { key, label: TASK_GROUP_LABELS[key], count: counts[key], collapsed, ...buildPage(items, counts[key], paging) };
    }),
  );
  return { timeZone: bounds.timeZone, counts, groups };
}
