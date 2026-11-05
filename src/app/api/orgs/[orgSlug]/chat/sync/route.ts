import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { syncChat } from "@/services/chatRealtimeService";

const SyncQuery = z.object({
  since: z.string().datetime().optional(),
  waitSeconds: z.string().regex(/^\d{1,2}$/).optional(),
});

/** `known[<channelId>]=<highest message number held>`, one per channel. */
function knownFrom(searchParams: URLSearchParams): Record<string, number> {
  const known: Record<string, number> = {};
  for (const [name, value] of searchParams.entries()) {
    const match = /^known\[([^\]]+)\]$/.exec(name);
    if (match && /^\d+$/.test(value)) known[match[1]!] = Number(value);
  }
  return known;
}

// The one call a chat screen polls: counts, new messages above the numbers it holds, changes, presence and typing. Optional long poll.
export async function GET(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const { searchParams } = new URL(request.url);
    const q = parseQueryParams(searchParams, SyncQuery);
    return syncChat(ctx, { known: knownFrom(searchParams), since: q.since ? new Date(q.since) : undefined, waitSeconds: q.waitSeconds ? Number(q.waitSeconds) : undefined });
  });
}
