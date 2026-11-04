import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { requireRecentVerification } from "@/services/platformAdminService";
import { requirePlatformApi } from "@/app/api/platform/_lib/platformRoute";
import { transitionOrganization } from "@/services/organizationLifecycleService";

const Body = z.strictObject({
  action: z.enum(["suspend", "reactivate", "offboard"], { error: "action must be suspend, reactivate or offboard." }),
  reason: z.string({ error: "A reason is required." }),
});

/** Suspend, reactivate or start offboarding an organisation, with a written reason (PL5). Enforced everywhere the tenant app serves data. FIG-1137. */
export async function POST(request: Request, { params }: { params: Promise<{ organizationId: string }> }) {
  return handleRoute(async () => {
    const platform = await requirePlatformApi("platform.organizations.suspend");
    await requireRecentVerification(platform);
    const { organizationId } = await params;
    const body = await parseJsonBody(request, Body);
    return transitionOrganization(platform, organizationId, body.action, body.reason, { requestId: request.headers.get("x-request-id") });
  });
}
