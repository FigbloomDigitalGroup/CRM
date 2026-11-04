import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { requirePlatformApi } from "@/app/api/platform/_lib/platformRoute";
import { cancelDataRequest } from "@/services/platformDataRequestService";

const Body = z.strictObject({ reason: z.string({ error: "A reason is required." }) });

/** Closes an open request, with a reason; a deletion that had started offboarding puts the organisation back. FIG-1141. */
export async function POST(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  return handleRoute(async () => {
    const platform = await requirePlatformApi("platform.data_requests.manage");
    const { requestId } = await params;
    const body = await parseJsonBody(request, Body);
    return cancelDataRequest(platform, requestId, body.reason, { requestId: request.headers.get("x-request-id") });
  });
}
