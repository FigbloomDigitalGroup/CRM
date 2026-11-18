import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { pageQueryShape } from "@/app/api/_lib/pageQuery";
import { withIdempotency } from "@/lib/idempotency";
import { createChannel, listChannels } from "@/services/chatService";

const ListQuery = z.object({ includeArchived: z.enum(["true", "false"]).optional(), ...pageQueryShape });

const CreateChannel = z.strictObject({
  kind: z.enum(["PUBLIC", "PRIVATE", "DIRECT", "RECORD"]),
  name: z.string().max(80).optional(),
  description: z.string().max(300).optional(),
  memberIds: z.array(z.string()).max(200).optional(),
  record: z.strictObject({ type: z.enum(["DEAL", "COMPANY", "LEAD"]), id: z.string() }).optional(),
});

// The channels this person can see, with unread counts (design F6.21, FIG-1382).
export async function GET(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, ListQuery);
    return listChannels(ctx, { includeArchived: query.includeArchived === "true" });
  });
}

// Creates a channel or opens a direct message. `Idempotency-Key` makes a double submit create it once.
export async function POST(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, CreateChannel);
    return withIdempotency(ctx, request, body, () => createChannel(ctx, body));
  });
}
