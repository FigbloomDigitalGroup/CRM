import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { getPoolMode, setPoolMode } from "@/services/leadPoolService";

const SettingsSchema = z.strictObject({ mode: z.enum(["approval", "auto"]) });

// How requests are answered: Management approves each one (approval, default) or the first request wins (auto).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return { mode: await getPoolMode(ctx.organizationId) };
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, SettingsSchema);
    return setPoolMode(ctx, body.mode);
  });
}
