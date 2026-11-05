import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { pageQueryShape, toPageRequest } from "@/app/api/_lib/pageQuery";
import { searchMessages } from "@/services/chatService";

const SearchQuery = z.object({ q: z.string().max(200), ...pageQueryShape });

// Messages the caller may read that match the text.
export async function GET(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const q = parseQueryParams(new URL(request.url).searchParams, SearchQuery);
    return searchMessages(ctx, q.q, toPageRequest(q));
  });
}
