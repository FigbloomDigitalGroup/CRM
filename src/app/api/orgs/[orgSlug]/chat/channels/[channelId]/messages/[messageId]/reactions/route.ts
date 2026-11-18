import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { setReaction } from "@/services/chatService";

const Reaction = z.strictObject({ emoji: z.string().min(1).max(16) });
const RemoveQuery = z.object({ emoji: z.string().min(1).max(16) });

export async function POST(request: Request, { params }: { params: Promise<{ orgSlug: string; channelId: string; messageId: string }> }) {
  return handleRoute(async () => {
    const { orgSlug, channelId, messageId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, Reaction);
    return setReaction(ctx, channelId, messageId, body.emoji, true);
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ orgSlug: string; channelId: string; messageId: string }> }) {
  return handleRoute(async () => {
    const { orgSlug, channelId, messageId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const q = parseQueryParams(new URL(request.url).searchParams, RemoveQuery);
    return setReaction(ctx, channelId, messageId, q.emoji, false);
  });
}
