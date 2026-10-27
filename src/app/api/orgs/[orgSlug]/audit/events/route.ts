import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { pageQueryShape, toPageRequest } from "@/app/api/_lib/pageQuery";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { listOrganizationAuditLog } from "@/services/auditLogService";

const AuditLogQuerySchema = z.object({
  actorMembershipId: z.string().optional(),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  /** An exact action, or a prefix ending in "*" such as "membership.*". */
  action: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  ...pageQueryShape,
});

// Settings > Audit log (FIG-799, B4.09): every audit event for the organisation, filtered and paged. `audit.view` (Management).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, AuditLogQuerySchema);
    return listOrganizationAuditLog(ctx, query, toPageRequest(query));
  });
}
