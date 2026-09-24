import type { AuthContext } from "../auth/context";
import {
  hasPermission,
  requirePermission,
  requireOwnedRecordPermission,
} from "../auth/context";
import { ForbiddenError, NotFoundError, ValidationError } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import {
  createTask as createTaskRecord,
  getTaskById,
  listTasks as listTasksRecords,
  updateTask as updateTaskRecord,
  type CreateTaskInput,
  type ListTasksFilters,
} from "../repositories/tasks";
import { assertCanAccessLinkedRecords } from "./recordAccess";

export type CreateTaskServiceInput = Omit<
  CreateTaskInput,
  "organizationId" | "createdByMembershipId" | "assigneeMembershipId" | "dueAt"
> & { assigneeMembershipId?: string; dueAt?: string };

async function resolveAssignee(ctx: AuthContext, requested?: string) {
  if (hasPermission(ctx, "tasks.assign.any")) {
    if (!requested || requested === ctx.membershipId) {
      return ctx.membershipId;
    }
    const target = await adminDb.membership.findFirst({
      where: { id: requested, organizationId: ctx.organizationId, status: "ACTIVE" },
    });
    if (!target) {
      throw new ValidationError(
        "The assignee must be an active member of this organization.",
      );
    }
    return target.id;
  }

  // tasks.assign.own means "assign to self" -- a client-supplied assignee
  // is never trusted here, same discipline as leadService.assignLead.
  requirePermission(ctx, "tasks.assign.own");
  return ctx.membershipId;
}

export async function createTask(
  ctx: AuthContext,
  input: CreateTaskServiceInput,
) {
  requirePermission(ctx, "tasks.create");
  await assertCanAccessLinkedRecords(ctx, input);
  const assigneeMembershipId = await resolveAssignee(
    ctx,
    input.assigneeMembershipId,
  );

  return createTaskRecord({
    ...input,
    organizationId: ctx.organizationId,
    createdByMembershipId: ctx.membershipId,
    assigneeMembershipId,
    dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
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
export async function listTasks(
  ctx: AuthContext,
  filters: ListTasksFilters = {},
) {
  if (hasPermission(ctx, "tasks.view.all")) {
    return listTasksRecords(ctx.organizationId, filters);
  }
  requirePermission(ctx, "tasks.view.own");
  return listTasksRecords(ctx.organizationId, {
    ...filters,
    assigneeMembershipId: ctx.membershipId,
  });
}

/**
 * There is no dedicated `tasks.edit` permission in the FIG-437 catalog
 * (only create/assign/view) -- the permission matrix is explicitly
 * provisional (see IMPLEMENTATION_NOTES.md). The judgment call made here:
 * a task may be updated (status changed, marked complete, edited) by its
 * assignee, its creator, or anyone holding `tasks.assign.any` (the same
 * "can touch anyone's tasks" breadth Management already has for
 * assignment). This still requires the caller to be able to *view* the
 * task at all, checked first.
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

  let assigneeMembershipId: string | undefined;
  if (
    input.assigneeMembershipId !== undefined &&
    input.assigneeMembershipId !== task.assigneeMembershipId
  ) {
    requirePermission(ctx, "tasks.assign.any");
    const target = await adminDb.membership.findFirst({
      where: {
        id: input.assigneeMembershipId,
        organizationId: ctx.organizationId,
        status: "ACTIVE",
      },
    });
    if (!target) {
      throw new ValidationError(
        "The assignee must be an active member of this organization.",
      );
    }
    assigneeMembershipId = target.id;
  }

  return updateTaskRecord(ctx.organizationId, taskId, {
    title: input.title,
    description: input.description,
    assigneeMembershipId,
    dueAt: input.dueAt === undefined ? undefined : input.dueAt ? new Date(input.dueAt) : null,
    priority: input.priority,
    status: input.status,
    completedAt:
      input.status === undefined
        ? undefined
        : input.status === "COMPLETED"
          ? new Date()
          : null,
  });
}
