import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { listLeadKeyNotes } from "@/services/leadKeyNoteService";

const Query = z.object({ leadIds: z.string().max(4000).default("") });

// The latest key notes (NOTE activities) for the leads on screen, in one call (FIG-1678). `leadIds` is a comma-separated list.
export async function GET(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const q = parseQueryParams(new URL(request.url).searchParams, Query);
    return listLeadKeyNotes(ctx, q.leadIds.split(",").map((s) => s.trim()).filter(Boolean));
  });
}
