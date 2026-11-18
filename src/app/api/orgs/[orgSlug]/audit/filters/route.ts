import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { getAuditLogFilters } from "@/services/auditLogService";

// What the audit log filters offer: entity types, actions and the people who have acted (FIG-799).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getAuditLogFilters(ctx);
  });
}
