import { handleRoute } from "@/app/api/_lib/handleRoute";
import { UnauthorizedError } from "@/auth/errors";
import { secretsMatch } from "@/auth/secretCompare";
import { purgeExpiredExports } from "@/services/platformDataRequestService";
import { verifyAuditChain } from "@/services/platformAuditService";

/**
 * The platform's own scheduled work (B6.06, B6.09), called by the same external cron as the other `/api/cron/*` routes with
 * `Authorization: Bearer <CRON_SECRET>`. The job framework (B2.18) runs per organisation, and this work belongs to no organisation,
 * so it is a route like the notifications sweep:
 *   - verifies the platform audit log's hash chain and stores the result (a broken chain is also logged as an error, which alerting hears);
 *   - purges organisation exports whose download window has ended.
 * Deleting an organisation is never scheduled: it is a separate, deliberate call.
 */
function assertAuthorized(request: Request): void {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET is not configured -- refusing to run platform maintenance.");
  const header = request.headers.get("authorization");
  const provided = header?.toLowerCase().startsWith("bearer ") ? header.slice("bearer ".length) : request.headers.get("x-cron-secret");
  if (!secretsMatch(provided, secret)) throw new UnauthorizedError("Invalid or missing cron secret.");
}

async function handle(request: Request) {
  return handleRoute(async () => {
    assertAuthorized(request);
    const audit = await verifyAuditChain("SCHEDULED");
    if (!audit.ok) {
      const { logger } = await import("@/lib/logger");
      logger.error({ firstBadSeq: audit.firstBadSeq, problem: audit.problem }, "Platform audit log failed its integrity check");
    }
    const exportsPurged = await purgeExpiredExports();
    return { audit: { ok: audit.ok, rowsChecked: audit.rowsChecked, firstBadSeq: audit.firstBadSeq, problem: audit.problem }, exportsPurged: exportsPurged.purged };
  });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
