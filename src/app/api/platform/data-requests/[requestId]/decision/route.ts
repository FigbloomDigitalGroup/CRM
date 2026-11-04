import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { requirePlatformApi } from "@/app/api/platform/_lib/platformRoute";
import { decideDataRequest } from "@/services/platformDataRequestService";

const Body = z.strictObject({ decision: z.enum(["APPROVE", "REJECT"], { error: "decision must be APPROVE or REJECT." }), comment: z.string().optional() });

/** One platform admin's decision. A deletion needs two different admins; a rejection needs a reason. FIG-1141. */
export async function POST(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  return handleRoute(async () => {
    const platform = await requirePlatformApi("platform.data_requests.manage");
    const { requestId } = await params;
    return decideDataRequest(platform, requestId, await parseJsonBody(request, Body), { requestId: request.headers.get("x-request-id") });
  });
}
