import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { mergeTags } from "@/services/tagService";

const MergeTagSchema = z.strictObject({ intoTagId: z.string({ error: "intoTagId is required." }) });

// Merges the tag in the URL into another: records tagged with the first end up tagged with the second, once.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; tagId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, tagId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, MergeTagSchema);
    return mergeTags(ctx, tagId, body.intoTagId);
  });
}
