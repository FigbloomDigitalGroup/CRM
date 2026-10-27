import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { withIdempotency } from "@/lib/idempotency";
import { mergeReferenceValues } from "@/services/referenceAdminService";

const MergeSchema = z.strictObject({ intoId: z.string({ error: "intoId is required." }) });

// Merge this value into another: every reference moves, this one is removed, the merge is audited (FIG-1063).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; kind: string; valueId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, kind, valueId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, MergeSchema);
    return withIdempotency(ctx, request, { kind, valueId, ...body }, () => mergeReferenceValues(ctx, kind, valueId, body.intoId));
  });
}
