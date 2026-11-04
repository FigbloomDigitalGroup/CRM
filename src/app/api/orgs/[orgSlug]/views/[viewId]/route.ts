import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { deleteView, getView, updateView } from "@/services/savedViewService";

const UpdateViewSchema = z.strictObject({
  name: z.string().optional(),
  scope: z.string().optional(),
  filters: z.unknown().optional(),
  sort: z.unknown().optional(),
  columns: z.unknown().optional(),
});

type Params = { params: Promise<{ orgSlug: string; viewId: string }> };

export async function GET(_request: Request, { params }: Params) {
  return handleRoute(async () => {
    const { orgSlug, viewId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getView(ctx, viewId);
  });
}

// Only the person who made a view renames, changes, shares or unshares it.
export async function PATCH(request: Request, { params }: Params) {
  return handleRoute(async () => {
    const { orgSlug, viewId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, UpdateViewSchema);
    return updateView(ctx, viewId, body);
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return handleRoute(async () => {
    const { orgSlug, viewId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return deleteView(ctx, viewId);
  });
}
