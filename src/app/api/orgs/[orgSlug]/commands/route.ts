import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { getCommandIndex } from "@/services/helpService";

// The command palette's index (design X3, FIG-1149): only the pages and actions the caller's role may use, and the kinds of record search may return.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getCommandIndex(ctx);
  });
}
