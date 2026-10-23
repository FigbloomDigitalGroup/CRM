import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { clearRecents, recentSearches, rememberRecentSearch } from "@/services/searchService";

// The caller's own recent searches (FIG-1041): newest first, at most ten.
const RememberSchema = z.strictObject({ query: z.string({ error: "query is required." }) });

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return { recents: await recentSearches(ctx) };
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, RememberSchema);
    return { recents: await rememberRecentSearch(ctx, body.query) };
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return clearRecents(ctx);
  });
}
