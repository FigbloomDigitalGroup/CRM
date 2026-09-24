import { withOrgContext } from "../db/orgScopedClient";

export interface CreateTaskInput {
  organizationId: string;
  title: string;
  description?: string;
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
 * `completedAt` is only ever set here as a value the service layer derived
 * from a `status` transition (mirrors `dealService.ts`'s outcome/stage
 * discipline) -- never a direct pass-through of client input, so a task
 * can't be marked COMPLETED without also stamping when.
 */
export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
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
  assigneeMembershipId?: string;
  status?: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  companyId?: string;
  contactId?: string;
  leadId?: string;
  dealId?: string;
  overdueOnly?: boolean;
}

/**
 * "Overdue" is derived at query time (dueAt in the past AND not
 * completed/cancelled), never stored -- FIG-436 section 13.
 */
export async function listTasks(
  organizationId: string,
  filters: ListTasksFilters = {},
) {
  return withOrgContext(organizationId, (tx) =>
    tx.task.findMany({
      where: {
        organizationId,
        assigneeMembershipId: filters.assigneeMembershipId,
        status: filters.status,
        companyId: filters.companyId,
        contactId: filters.contactId,
        leadId: filters.leadId,
        dealId: filters.dealId,
        ...(filters.overdueOnly
          ? {
              dueAt: { lt: new Date() },
              status: { in: ["PENDING", "IN_PROGRESS"] },
            }
          : {}),
      },
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
    }),
  );
}
