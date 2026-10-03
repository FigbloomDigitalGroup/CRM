import { csvExportResponse } from "@/app/api/_lib/csvExportResponse";
import { handleCsvRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { exportLeadsCsv } from "@/services/exportService";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleCsvRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const { searchParams } = new URL(request.url);
    const csv = await exportLeadsCsv(ctx, {
      query: searchParams.get("q") ?? undefined,
      ownerMembershipId: searchParams.get("ownerMembershipId") ?? undefined,
      leadStatusId: searchParams.get("leadStatusId") ?? undefined,
      leadSourceId: searchParams.get("leadSourceId") ?? undefined,
    });
    return csvExportResponse(csv, "leads.csv");
  });
}
