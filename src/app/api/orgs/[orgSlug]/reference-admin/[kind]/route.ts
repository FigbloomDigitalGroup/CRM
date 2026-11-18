import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { withIdempotency } from "@/lib/idempotency";
import { createReferenceValue, listReferenceValues } from "@/services/referenceAdminService";

// Extras differ by list (description or category for catalogs, colour for tags, subject and body for templates,
// entityType, key and fieldType for custom fields); the service checks the ones its list needs.
const CreateSchema = z.looseObject({ name: z.string({ error: "name is required." }) });

// Every value of one list, hidden ones included, with its usage count (FIG-1063, B4.06).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; kind: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, kind } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return { items: await listReferenceValues(ctx, kind) };
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; kind: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, kind } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, CreateSchema);
    return withIdempotency(ctx, request, body, () => createReferenceValue(ctx, kind, body));
  });
}
