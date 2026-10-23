import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { changeTags, getRecordTags } from "@/services/tagService";

const ChangeTagsSchema = z.strictObject({
  addTagIds: z.array(z.string()).max(50).optional(),
  /** Existing tags by name (any case); a new name creates the tag, which needs tags.manage. */
  addTagNames: z.array(z.string()).max(50).optional(),
  removeTagIds: z.array(z.string()).max(50).optional(),
});

// Tags on one deal (FIG-798): read them, or add and remove tags inline.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; dealId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, dealId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return { tags: await getRecordTags(ctx, "deal", dealId) };
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; dealId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, dealId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, ChangeTagsSchema);
    return { tags: await changeTags(ctx, "deal", dealId, body) };
  });
}
