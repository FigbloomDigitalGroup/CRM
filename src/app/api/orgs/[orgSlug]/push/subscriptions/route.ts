import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { listMyPushSubscriptions, registerPushSubscription } from "@/services/pushService";

const RegisterSchema = z.strictObject({
  endpoint: z.string({ error: "endpoint is required." }),
  keys: z.strictObject({ p256dh: z.string({ error: "keys.p256dh is required." }), auth: z.string({ error: "keys.auth is required." }) }),
  userAgent: z.string().optional(),
});

// The caller's own registered devices (FIG-1064, B4.07).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return listMyPushSubscriptions(ctx);
  });
}

// Register this browser or phone for push. The same endpoint again re-arms it and changes nothing else.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, RegisterSchema);
    return registerPushSubscription(ctx, body);
  });
}
