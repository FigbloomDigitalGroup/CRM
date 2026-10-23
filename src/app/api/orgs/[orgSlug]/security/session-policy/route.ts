import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { getSessionPolicy, updateSessionPolicy } from "@/services/sessionService";

const PolicySchema = z.object({
  lifetimeHours: z.number({ error: "lifetimeHours must be a number." }),
});

/** The organisation's session lifetime policy (B1.04; needs `security.manage`). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getSessionPolicy(ctx);
  });
}

/** Management picks 4, 8, 12 or 24 hours. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, PolicySchema);
    return updateSessionPolicy(ctx, body.lifetimeHours);
  });
}
