import { handleCsvRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { exportInvoicesCsv } from "@/services/paymentService";

// CSV of the invoices matching the list filters. Finance and Management only; above 500 rows it needs export.bulk, like every export.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleCsvRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const sp = new URL(request.url).searchParams;
    const csv = await exportInvoicesCsv(ctx, {
      status: sp.get("status") || undefined,
      overdue: sp.get("overdue") === "true",
      companyId: sp.get("companyId") || undefined,
      dealId: sp.get("dealId") || undefined,
      dueFrom: sp.get("dueFrom") || undefined,
      dueTo: sp.get("dueTo") || undefined,
      q: sp.get("q") || undefined,
    });
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="invoices.csv"' } });
  });
}
