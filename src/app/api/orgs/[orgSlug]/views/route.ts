import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { withIdempotency } from "@/lib/idempotency";
import { createView, listViews } from "@/services/savedViewService";

const ListQuerySchema = z.object({
  entity: z.string().optional(),
  pinned: z.enum(["true", "false"]).optional(),
});
const CreateViewSchema = z.strictObject({
  entity: z.string({ error: "entity is required." }),
  name: z.string({ error: "name is required." }),
  scope: z.string().optional(),
  filters: z.unknown().optional(),
  sort: z.unknown().optional(),
  columns: z.unknown().optional(),
  pinned: z.boolean().optional(),
});

// Saved views the caller may use: their own and the shared ones for lists their role may open (FIG-1148, X4). `?pinned=true` is the sidebar.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, ListQuerySchema);
    return listViews(ctx, { entity: query.entity, pinned: query.pinned === "true" });
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, CreateViewSchema);
    return withIdempotency(ctx, request, body, () => createView(ctx, body));
  });
}
