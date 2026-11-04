import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { getMessageAttachmentLink } from "@/services/chatService";

// A short-lived signed download link for a file attached to a message, for anyone who can read the channel.
export async function GET(request: Request, { params }: { params: Promise<{ orgSlug: string; channelId: string; messageId: string; fileId: string }> }) {
  return handleRoute(async () => {
    const { orgSlug, channelId, messageId, fileId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getMessageAttachmentLink(ctx, channelId, messageId, fileId);
  });
}
