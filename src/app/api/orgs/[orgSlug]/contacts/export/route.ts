import { csvExportResponse } from "@/app/api/_lib/csvExportResponse";
import { handleCsvRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { exportContactsCsv } from "@/services/exportService";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleCsvRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const { searchParams } = new URL(request.url);
    const csv = await exportContactsCsv(ctx, {
      query: searchParams.get("q") ?? undefined,
    });
    return csvExportResponse(csv, "contacts.csv");
  });
}
