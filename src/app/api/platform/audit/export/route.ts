import { z } from "zod";
import { handleCsvRoute } from "@/app/api/_lib/handleRoute";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { requirePlatformApi } from "@/app/api/platform/_lib/platformRoute";
import { getPlatformDb } from "@/db/platformClient";
import { exportAuditCsv, recordPlatformAudit } from "@/services/platformAuditService";

const Query = z.object({
  action: z.string().optional(),
  organizationId: z.string().optional(),
  actorIdentityId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/** The same filters as the log, as a CSV (PL8). Exporting is itself recorded in the log. FIG-1138. */
export async function GET(request: Request) {
  return handleCsvRoute(async () => {
    const platform = await requirePlatformApi("platform.audit.view");
    const { csv, rows, truncated } = await exportAuditCsv(parseQueryParams(new URL(request.url).searchParams, Query));
    await recordPlatformAudit(getPlatformDb(), {
      actorIdentityId: platform.identityId,
      actorLabel: platform.email,
      action: "audit.exported",
      targetType: "AuditLog",
      metadata: { rows, truncated },
      requestId: request.headers.get("x-request-id"),
    });
    return new Response(csv, {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="platform-audit-log.csv"', "x-truncated": String(truncated) },
    });
  });
}
