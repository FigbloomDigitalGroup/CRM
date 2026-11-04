import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { markRead } from "@/services/chatService";

const MarkRead = z.strictObject({ upToSeq: z.number().int().min(0).optional() });

// Marks the channel read up to a message number (the latest when none is given).
export async function POST(request: Request, { params }: { params: Promise<{ orgSlug: string; channelId: string }> }) {
  return handleRoute(async () => {
    const { orgSlug, channelId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const text = await request.text();
    const body = text.trim() ? await parseJsonBody(new Request(request.url, { method: "POST", body: text, headers: { "content-type": "application/json" } }), MarkRead) : {};
    return markRead(ctx, channelId, (body as { upToSeq?: number }).upToSeq);
  });
}
