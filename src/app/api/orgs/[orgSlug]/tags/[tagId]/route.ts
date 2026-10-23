import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { deleteTag, updateTag } from "@/services/tagService";

const UpdateTagSchema = z.strictObject({
  name: z.string().optional(),
  colour: z.string().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; tagId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, tagId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, UpdateTagSchema);
    return updateTag(ctx, tagId, body);
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; tagId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, tagId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return deleteTag(ctx, tagId);
  });
}
