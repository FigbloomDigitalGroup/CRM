import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveGatedContext } from "@/app/api/_lib/gatedContext";
import { getSupportBanner } from "@/services/supportAccessService";

/**
 * Whether a support session is running now (the banner every member sees, OS3) and, for Management, the request waiting for a decision (OS2).
 * Any active member; only Management gets the reason, the ticket and the waiting request. FIG-1183 (V2).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const ctx = await resolveGatedContext((await params).orgSlug, "release.v2");
    return getSupportBanner(ctx);
  });
}
