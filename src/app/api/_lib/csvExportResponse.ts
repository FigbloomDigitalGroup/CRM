import { csvResponseStream } from "@/lib/csv";
import type { CsvExport } from "@/services/exportService";

/** Streams a `CsvExport` as a downloadable `.csv` attachment (FIG-596). */
export function csvExportResponse(
  { columns, rows }: CsvExport,
  filename: string,
): Response {
  return new Response(csvResponseStream(columns, rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
