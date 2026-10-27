import { csvExportResponse } from "@/app/api/_lib/csvExportResponse";
import { handleCsvRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { contactFiltersForExport } from "@/services/directoryService";
import { exportContactsCsv } from "@/services/exportService";

// CSV of the contacts matching the directory filters (FIG-1056). Needs contacts.export and follows the bulk-export rule.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleCsvRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const sp = new URL(request.url).searchParams;
    const filters = contactFiltersForExport({
      query: sp.get("q") || undefined,
      companyId: sp.get("companyId") || undefined,
      ownerMembershipId: sp.get("ownerMembershipId") || undefined,
      standalone: sp.get("standalone") === "true",
      missingEmail: sp.get("missingEmail") === "true",
      missingPhone: sp.get("missingPhone") === "true",
      archived: sp.get("archived") === "true",
      tagIds: sp.get("tagId") ? sp.get("tagId")!.split(",").filter(Boolean) : undefined,
    });
    return csvExportResponse(await exportContactsCsv(ctx, filters), "contacts.csv");
  });
}
