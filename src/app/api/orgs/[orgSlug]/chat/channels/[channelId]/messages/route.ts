import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { withIdempotency } from "@/lib/idempotency";
import { listMessages, postMessage } from "@/services/chatService";

const ListQuery = z.object({
  before: z.string().regex(/^\d+$/).optional(),
  after: z.string().regex(/^\d+$/).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
});

const PostMessage = z.strictObject({
  body: z.string().max(4000).optional(),
  card: z.strictObject({ type: z.enum(["DEAL", "COMPANY", "LEAD", "INVOICE"]), id: z.string() }).optional(),
  mentions: z.array(z.string()).max(50).optional(),
  fileIds: z.array(z.string()).max(10).optional(),
});

// Messages in number order: the latest page, `before` a number (older) or `after` a number (everything newer).
export async function GET(request: Request, { params }: { params: Promise<{ orgSlug: string; channelId: string }> }) {
  return handleRoute(async () => {
    const { orgSlug, channelId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const q = parseQueryParams(new URL(request.url).searchParams, ListQuery);
    return listMessages(ctx, channelId, {
      before: q.before ? Number(q.before) : undefined,
      after: q.after ? Number(q.after) : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    });
  });
}

// Posts a message. `Idempotency-Key` makes a retry (a double tap, an offline queue replay) post once.
export async function POST(request: Request, { params }: { params: Promise<{ orgSlug: string; channelId: string }> }) {
  return handleRoute(async () => {
    const { orgSlug, channelId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, PostMessage);
    return withIdempotency(ctx, request, body, () => postMessage(ctx, channelId, body));
  });
}
