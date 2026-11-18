import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { reorderReferenceValue } from "@/services/referenceAdminService";

const ReorderSchema = z.strictObject({ direction: z.enum(["up", "down"], { error: "direction must be up or down." }) });

// Move one value up or down in its list; returns the list in its new order (FIG-1063).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; kind: string; valueId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, kind, valueId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, ReorderSchema);
    return { items: await reorderReferenceValue(ctx, kind, valueId, body.direction) };
  });
}
