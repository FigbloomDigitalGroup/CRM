import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { resetMyAppearance } from "@/services/preferenceService";

/** Back to the brand look (Forest on White). Returns a one-time undo token valid for ten minutes. */
export async function POST(_request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return resetMyAppearance(ctx);
  });
}
