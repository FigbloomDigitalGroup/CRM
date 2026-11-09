import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveGatedContext } from "@/app/api/_lib/gatedContext";
import { endSupportAccessByOrganisation } from "@/services/supportAccessService";

/** End a running support session now (or withdraw an approval). Management, at any moment (OS3). FIG-1183 (V2). */
export async function POST(_request: Request, { params }: { params: Promise<{ orgSlug: string; grantId: string }> }) {
  return handleRoute(async () => {
    const p = await params;
    const ctx = await resolveGatedContext(p.orgSlug, "release.v2");
    return endSupportAccessByOrganisation(ctx, p.grantId);
  });
}
