import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { restoreTask } from "@/services/taskService";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; taskId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, taskId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return restoreTask(ctx, taskId);
  });
}
