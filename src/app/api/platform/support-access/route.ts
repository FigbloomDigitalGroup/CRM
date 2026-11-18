import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, parseQueryParams } from "@/app/api/_lib/validation";
import { requirePlatformV2Api } from "@/app/api/platform/_lib/platformRoute";
import { requireRecentVerification } from "@/services/platformAdminService";
import { listSupportAccess, requestSupportAccess } from "@/services/supportAccessService";

const Body = z.strictObject({
  organizationId: z.string({ error: "organizationId is required." }),
  reason: z.string({ error: "A reason is required." }),
  ticketReference: z.string({ error: "A ticket reference is required." }),
  scope: z.array(z.string(), { error: "Choose what support may look at." }),
  durationMinutes: z.number({ error: "Choose 30, 60 or 120 minutes." }),
  unmaskContactDetails: z.boolean().optional(),
});

/** Support access requests and sessions across organisations, newest first (PL7). FIG-1183 (V2). */
export async function GET(request: Request) {
  return handleRoute(async () => {
    await requirePlatformV2Api("platform.support.request");
    return listSupportAccess(parseQueryParams(new URL(request.url).searchParams, z.object({ organizationId: z.string().optional(), status: z.string().optional() })));
  });
}

/** Ask an organisation for time-boxed, read-only support access. Nothing is readable until its Management approves and this admin opens it. FIG-1183 (V2). */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const platform = await requirePlatformV2Api("platform.support.request");
    await requireRecentVerification(platform);
    const body = await parseJsonBody(request, Body);
    return requestSupportAccess(platform, body, { requestId: request.headers.get("x-request-id") });
  });
}
