import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { createTag, listTags } from "@/services/tagService";

const ListQuerySchema = z.object({
  q: z.string().max(40).optional(),
  /** Tag managers only: include hidden tags (B4.06). The picker leaves them out. */
  includeHidden: z.enum(["true", "false"]).optional(),
});
const CreateTagSchema = z.strictObject({
  name: z.string({ error: "name is required." }),
  colour: z.string().optional(),
});

// The organisation tags with how many records carry each (FIG-798).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, ListQuerySchema);
    return { items: await listTags(ctx, query.q, { includeHidden: query.includeHidden === "true" }) };
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, CreateTagSchema);
    return createTag(ctx, body);
  });
}
