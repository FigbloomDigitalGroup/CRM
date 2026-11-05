import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { deleteChannel, getChannel, updateChannel } from "@/services/chatService";

const UpdateChannel = z.strictObject({
  name: z.string().max(80).optional(),
  description: z.string().max(300).nullable().optional(),
  archived: z.boolean().optional(),
});

export async function GET(request: Request, { params }: { params: Promise<{ orgSlug: string; channelId: string }> }) {
  return handleRoute(async () => {
    const { orgSlug, channelId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getChannel(ctx, channelId);
  });
}

// Rename, change the description, archive or restore.
export async function PATCH(request: Request, { params }: { params: Promise<{ orgSlug: string; channelId: string }> }) {
  return handleRoute(async () => {
    const { orgSlug, channelId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, UpdateChannel);
    return updateChannel(ctx, channelId, body);
  });
}

// Deletes an archived channel and its messages.
export async function DELETE(request: Request, { params }: { params: Promise<{ orgSlug: string; channelId: string }> }) {
  return handleRoute(async () => {
    const { orgSlug, channelId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return deleteChannel(ctx, channelId);
  });
}
