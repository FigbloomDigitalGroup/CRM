import { handleCsvRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { getMigrationErrorReport } from "@/services/migrationService";

// The error report as CSV: each problem row beside its original values, ready to fix and upload again. `?phase=VALIDATE|IMPORT`.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; sessionId: string }> },
) {
  return handleCsvRoute(async () => {
    const { orgSlug, sessionId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const phase = new URL(request.url).searchParams.get("phase");
    const csv = await getMigrationErrorReport(ctx, sessionId, phase === "VALIDATE" || phase === "IMPORT" ? phase : "ALL");
    return new Response(new Uint8Array(csv), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="migration-errors.csv"' } });
  });
}
