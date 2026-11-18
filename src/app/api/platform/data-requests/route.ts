import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { requirePlatformApi } from "@/app/api/platform/_lib/platformRoute";
import { listDataRequests } from "@/services/platformDataRequestService";

const Query = z.object({
  status: z.string().optional(),
  kind: z.string().optional(),
  organizationId: z.string().optional(),
  page: z.coerce.number().int().optional(),
  pageSize: z.coerce.number().int().optional(),
});

/** The queue of organisations' export and deletion requests (PL6). FIG-1141. */
export async function GET(request: Request) {
  return handleRoute(async () => {
    await requirePlatformApi("platform.organizations.view");
    return listDataRequests(parseQueryParams(new URL(request.url).searchParams, Query));
  });
}
