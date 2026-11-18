import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { listReferenceKinds } from "@/services/referenceAdminService";

// The reference lists this caller may manage, and what each allows (FIG-1063, B4.06).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return { items: await listReferenceKinds(ctx) };
  });
}
