import { handleRoute } from "@/app/api/_lib/handleRoute";
import { requirePlatformApi } from "@/app/api/platform/_lib/platformRoute";
import { lastVerification, verifyAuditChain } from "@/services/platformAuditService";

/** The result of the last integrity check (PL8). */
export async function GET() {
  return handleRoute(async () => {
    await requirePlatformApi("platform.audit.view");
    return { last: await lastVerification() };
  });
}

/** Re-checks the whole chain now and stores the result. FIG-1138. */
export async function POST() {
  return handleRoute(async () => {
    await requirePlatformApi("platform.audit.view");
    return verifyAuditChain("MANUAL");
  });
}
