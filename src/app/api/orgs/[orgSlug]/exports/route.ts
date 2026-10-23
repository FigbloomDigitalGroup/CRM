import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { startExport } from "@/services/dataRunService";

// Starts a background export of the full filtered set (FIG-1034). Over 500 rows needs `export.bulk`.
const ExportSchema = z.strictObject({
  entity: z.enum(["LEAD", "CONTACT", "COMPANY", "DEAL"]),
  filters: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return startExport(ctx, await parseJsonBody(request, ExportSchema));
  });
}
