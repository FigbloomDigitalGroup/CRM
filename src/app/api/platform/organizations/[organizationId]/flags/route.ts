import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { requirePlatformV2Api } from "@/app/api/platform/_lib/platformRoute";
import { requireRecentVerification } from "@/services/platformAdminService";
import { getOrganizationFlags, updateOrganizationFlags } from "@/services/platformFlagsService";

const Body = z.strictObject({
  flags: z.record(z.string(), z.union([z.boolean(), z.null()])).optional(),
  limits: z.record(z.string(), z.union([z.number(), z.null()])).optional(),
  reason: z.string({ error: "A reason is required." }),
});

/** One organisation's flags, limits, usage and change history (PL12). Numbers and switches only. FIG-1184 (V2). */
export async function GET(_request: Request, { params }: { params: Promise<{ organizationId: string }> }) {
  return handleRoute(async () => {
    await requirePlatformV2Api("platform.organizations.view");
    return getOrganizationFlags((await params).organizationId);
  });
}

/** Fix or release flags and set or clear limits, with a written reason and a fresh second-step proof. Audited. FIG-1184 (V2). */
export async function PATCH(request: Request, { params }: { params: Promise<{ organizationId: string }> }) {
  return handleRoute(async () => {
    const platform = await requirePlatformV2Api("platform.flags.manage");
    await requireRecentVerification(platform);
    const { organizationId } = await params;
    const body = await parseJsonBody(request, Body);
    return updateOrganizationFlags(platform, organizationId, body, { requestId: request.headers.get("x-request-id") });
  });
}
