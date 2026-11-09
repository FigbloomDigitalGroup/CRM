import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveGatedContext } from "@/app/api/_lib/gatedContext";
import { getRoleCatalog } from "@/services/roleEditorService";

// What the roles editor offers (FIG-1188): every permission with whether this organisation may grant it, the controllable fields, the starting-point roles.
export async function GET(_request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    return getRoleCatalog(await resolveGatedContext(orgSlug, "release.v2"));
  });
}
