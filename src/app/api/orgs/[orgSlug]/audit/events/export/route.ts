import { handleCsvRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { exportOrganizationAuditLogCsv } from "@/services/auditLogService";

// CSV of the audit events the filters show (FIG-799). Exporting the log is audited; above 500 rows it needs export.bulk like every export.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleCsvRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const sp = new URL(request.url).searchParams;
    const csv = await exportOrganizationAuditLogCsv(ctx, {
      actorMembershipId: sp.get("actorMembershipId") || undefined,
      entityType: sp.get("entityType") || undefined,
      entityId: sp.get("entityId") || undefined,
      action: sp.get("action") || undefined,
      dateFrom: sp.get("dateFrom") || undefined,
      dateTo: sp.get("dateTo") || undefined,
    });
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="audit-log.csv"' } });
  });
}
