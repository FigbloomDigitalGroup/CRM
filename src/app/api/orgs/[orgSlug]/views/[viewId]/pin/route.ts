import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { setPinned } from "@/services/savedViewService";

const PinSchema = z.strictObject({ pinned: z.boolean({ error: "pinned is required." }) });

// Pins or unpins a view in the caller's own sidebar.
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; viewId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, viewId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, PinSchema);
    return setPinned(ctx, viewId, body.pinned);
  });
}
