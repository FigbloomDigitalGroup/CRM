import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveGatedContext } from "@/app/api/_lib/gatedContext";
import { getOrganisationSupportAccess } from "@/services/supportAccessService";

/** One request or session with the page-view log: what support looked at, and when (OS4). Management. FIG-1183 (V2). */
export async function GET(_request: Request, { params }: { params: Promise<{ orgSlug: string; grantId: string }> }) {
  return handleRoute(async () => {
    const p = await params;
    const ctx = await resolveGatedContext(p.orgSlug, "release.v2");
    return getOrganisationSupportAccess(ctx, p.grantId);
  });
}
