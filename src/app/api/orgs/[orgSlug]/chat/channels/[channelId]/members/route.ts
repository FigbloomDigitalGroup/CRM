import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { addMembers, listMembers } from "@/services/chatService";

const AddMembers = z.strictObject({ membershipIds: z.array(z.string()).min(1).max(100) });

export async function GET(request: Request, { params }: { params: Promise<{ orgSlug: string; channelId: string }> }) {
  return handleRoute(async () => {
    const { orgSlug, channelId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return listMembers(ctx, channelId);
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ orgSlug: string; channelId: string }> }) {
  return handleRoute(async () => {
    const { orgSlug, channelId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, AddMembers);
    return addMembers(ctx, channelId, body.membershipIds);
  });
}
