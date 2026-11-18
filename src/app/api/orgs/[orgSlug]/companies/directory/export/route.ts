import { csvExportResponse } from "@/app/api/_lib/csvExportResponse";
import { handleCsvRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { companyFiltersForTab } from "@/services/directoryService";
import { exportCompaniesCsv } from "@/services/exportService";

// CSV of one company tab with the same filters as the list (FIG-1056). Needs companies.export and follows the bulk-export rule.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleCsvRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const sp = new URL(request.url).searchParams;
    const filters = await companyFiltersForTab(ctx, {
      tab: sp.get("tab") || undefined,
      query: sp.get("q") || undefined,
      lifecycle: sp.get("lifecycle") || undefined,
      serviceId: sp.get("serviceId") || undefined,
      ownerMembershipId: sp.get("ownerMembershipId") || undefined,
      tagIds: sp.get("tagId") ? sp.get("tagId")!.split(",").filter(Boolean) : undefined,
    });
    return csvExportResponse(await exportCompaniesCsv(ctx, filters), "companies.csv");
  });
}
