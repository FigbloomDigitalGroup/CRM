import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveGatedContext } from "@/app/api/_lib/gatedContext";
import { listOrganisationSupportAccess } from "@/services/supportAccessService";

/** The organisation's history of support requests and sessions (OS4). Management (`security.manage`). FIG-1183 (V2). */
export async function GET(_request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const ctx = await resolveGatedContext((await params).orgSlug, "release.v2");
    return listOrganisationSupportAccess(ctx);
  });
}
