import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { requirePlatformApi } from "@/app/api/platform/_lib/platformRoute";
import { executeDeletion } from "@/services/platformDataRequestService";

const Body = z.strictObject({ confirmSlug: z.string({ error: "Type the organisation's slug to confirm." }) });

/** The irreversible step: two approvers, the waiting period over, export packaged, slug typed back. Stores the certificate. FIG-1141. */
export async function POST(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  return handleRoute(async () => {
    const platform = await requirePlatformApi("platform.data_requests.manage");
    const { requestId } = await params;
    return executeDeletion(platform, requestId, await parseJsonBody(request, Body), { requestId: request.headers.get("x-request-id") });
  });
}
