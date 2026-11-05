import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { reorderPins } from "@/services/savedViewService";

const OrderSchema = z.strictObject({ ids: z.array(z.string()).max(200) });

// Puts the caller's pinned views in the order given (every pinned view exactly once).
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, OrderSchema);
    return reorderPins(ctx, body.ids);
  });
}
