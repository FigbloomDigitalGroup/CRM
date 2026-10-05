import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, parseQueryParams, requiredString } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { createTask, listTasks } from "@/services/taskService";

const StatusEnum = z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"]);
const PriorityEnum = z.enum(["LOW", "MEDIUM", "HIGH"]);

const ListTasksQuerySchema = z.object({
  status: StatusEnum.optional(),
  companyId: z.string().optional(),
  contactId: z.string().optional(),
  leadId: z.string().optional(),
  dealId: z.string().optional(),
  overdueOnly: z.enum(["true", "false"]).optional(),
});

const CreateTaskSchema = z.object({
  title: requiredString("title is required."),
  description: z.string().optional(),
  assigneeMembershipId: z.string().optional(),
  // Deliberately a string, not z.coerce.date() -- taskService.createTask
  // does its own new Date() conversion.
  dueAt: z.string().optional(),
  priority: PriorityEnum.optional(),
  companyId: z.string().optional(),
  contactId: z.string().optional(),
  leadId: z.string().optional(),
  dealId: z.string().optional(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const { searchParams } = new URL(request.url);
    const query = parseQueryParams(searchParams, ListTasksQuerySchema);
    return listTasks(ctx, {
      status: query.status,
      companyId: query.companyId,
      contactId: query.contactId,
      leadId: query.leadId,
      dealId: query.dealId,
      overdueOnly: query.overdueOnly === "true",
    });
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, CreateTaskSchema);
    return createTask(ctx, body);
  });
}
