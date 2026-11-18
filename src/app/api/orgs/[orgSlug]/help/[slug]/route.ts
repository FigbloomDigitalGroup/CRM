import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { getHelpArticle } from "@/services/helpService";

// One Help article. An article written for a role the caller does not hold answers 404.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; slug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, slug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getHelpArticle(ctx, slug);
  });
}
