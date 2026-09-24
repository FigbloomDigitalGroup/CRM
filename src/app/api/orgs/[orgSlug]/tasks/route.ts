import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { createTask, listTasks } from "@/services/taskService";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const { searchParams } = new URL(request.url);
    return listTasks(ctx, {
      status:
        (searchParams.get("status") as
          | "PENDING"
          | "IN_PROGRESS"
          | "COMPLETED"
          | "CANCELLED"
          | null) ?? undefined,
      companyId: searchParams.get("companyId") ?? undefined,
      contactId: searchParams.get("contactId") ?? undefined,
      leadId: searchParams.get("leadId") ?? undefined,
      dealId: searchParams.get("dealId") ?? undefined,
      overdueOnly: searchParams.get("overdueOnly") === "true",
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
    const body = await request.json();
    return createTask(ctx, body);
  });
}
