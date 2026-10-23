import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { getMyWork } from "@/services/taskService";

const MyWorkQuerySchema = z.object({
  groups: z.string().max(100).optional(),
  pageSize: z.string().regex(/^\d+$/).optional(),
});

// Restricted Technical My work (FIG-1038, T1, D3): tasks with their requirements and files, and nothing else about the work.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, MyWorkQuerySchema);
    return getMyWork(ctx, {
      groups: query.groups?.split(",").map((g) => g.trim()).filter(Boolean),
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
    });
  });
}
