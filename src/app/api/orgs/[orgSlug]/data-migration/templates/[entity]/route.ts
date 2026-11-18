import { handleCsvRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { getMigrationTemplate } from "@/services/migrationService";

// The fixed template for one kind of record: the header row and one example row. Its own headers map themselves.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; entity: string }> },
) {
  return handleCsvRoute(async () => {
    const { orgSlug, entity } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return new Response(getMigrationTemplate(ctx, entity.toUpperCase()), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${entity.toLowerCase()}-template.csv"` },
    });
  });
}
