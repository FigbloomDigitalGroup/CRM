import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { getTask, updateTask } from "@/services/taskService";

type RouteParams = { params: Promise<{ orgSlug: string; taskId: string }> };

export async function GET(request: Request, { params }: RouteParams) {
  return handleRoute(async () => {
    const { orgSlug, taskId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getTask(ctx, taskId);
  });
}

export async function PATCH(request: Request, { params }: RouteParams) {
  return handleRoute(async () => {
    const { orgSlug, taskId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await request.json();
    return updateTask(ctx, taskId, body);
  });
}
