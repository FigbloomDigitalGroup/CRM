import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { deleteMessage } from "@/services/chatService";

// Deletes a message: its author, or a channel manager. The text is removed; the place in the thread stays.
export async function DELETE(request: Request, { params }: { params: Promise<{ orgSlug: string; channelId: string; messageId: string }> }) {
  return handleRoute(async () => {
    const { orgSlug, channelId, messageId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return deleteMessage(ctx, channelId, messageId);
  });
}
