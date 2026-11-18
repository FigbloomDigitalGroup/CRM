import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { requirePlatformV2Api } from "@/app/api/platform/_lib/platformRoute";
import { readSupportAccess } from "@/services/supportAccessService";

const Query = z.object({
  resource: z.string({ error: "resource is required." }),
  limit: z.coerce.number().int().optional(),
  offset: z.coerce.number().int().optional(),
});

/**
 * One page of read-only, masked records from the organisation, while the session is open and the kind of record was approved. Every page is
 * logged for the organisation and the platform. No deal value, payment, cost, margin, note or file is ever returned. FIG-1183 (V2).
 */
export async function GET(request: Request, { params }: { params: Promise<{ grantId: string }> }) {
  return handleRoute(async () => {
    const platform = await requirePlatformV2Api("platform.support.request");
    const query = parseQueryParams(new URL(request.url).searchParams, Query);
    return readSupportAccess(platform, (await params).grantId, query.resource, { limit: query.limit, offset: query.offset }, { requestId: request.headers.get("x-request-id") });
  });
}
