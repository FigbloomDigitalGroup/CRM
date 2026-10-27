import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { updateExportRights } from "@/services/privacyService";

const Schema = z.strictObject({
  allowedRoleKeys: z.array(z.string()).optional(),
  approvalThreshold: z.number().optional(),
  approvalExpiryHours: z.number().optional(),
});

// Who may export in bulk, the row count above which an export needs approval, and how long an approval lasts.
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> } ,
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return updateExportRights(ctx, await parseJsonBody(request, Schema));
  });
}
