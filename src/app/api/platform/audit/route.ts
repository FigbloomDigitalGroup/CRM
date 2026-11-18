import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { requirePlatformApi } from "@/app/api/platform/_lib/platformRoute";
import { listAuditEvents } from "@/services/platformAuditService";

const Query = z.object({
  action: z.string().optional(),
  organizationId: z.string().optional(),
  actorIdentityId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  before: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().optional(),
});

/** The platform audit log, newest first (PL8). Read-only: no route changes or removes an entry. FIG-1138. */
export async function GET(request: Request) {
  return handleRoute(async () => {
    await requirePlatformApi("platform.audit.view");
    return listAuditEvents(parseQueryParams(new URL(request.url).searchParams, Query));
  });
}
