import type { AuthContext } from "../auth/context";
import {
  hasPermission,
  requirePermission,
  requireOwnedRecordPermission,
} from "../auth/context";
import { ForbiddenError, NotFoundError, ValidationError } from "../auth/errors";
import {
  createTask as createTaskRecord,
  getTaskById,
  countTasks as countTasksRecords,
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
import { assertCanAccessLinkedRecords } from "./recordAccess";
import { buildPage, resolvePaging, type PageRequest } from "../lib/pagination";

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
  await assertCanAccessLinkedRecords(ctx, input);
  const assigneeMembershipId = await resolveAssignee(
    ctx,
    input.assigneeMembershipId,
  );

  return createTaskRecord({
    ...input,
    title: title!,
    organizationId: ctx.organizationId,
    createdByMembershipId: ctx.membershipId,
    assigneeMembershipId,
    dueAt: dueAt ?? undefined,
  });
}

async function loadVisibleTask(ctx: AuthContext, taskId: string) {
  const task = await getTaskById(ctx.organizationId, taskId);
  if (!task) {
    throw new NotFoundError("Task", taskId);
  }
  requireOwnedRecordPermission(
    ctx,
    "tasks.view.own",
    "tasks.view.all",
    task.assigneeMembershipId,
  );
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
    throw new ForbiddenError(
      "tasks.assign.any, or being this task's assignee/creator",
    );
  }

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

  return updateTaskRecord(ctx.organizationId, taskId, {
    title,
    description: input.description,
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
}
