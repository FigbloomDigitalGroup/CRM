import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { getRenewalSettings, updateRenewalSettings } from "@/services/recurringServiceService";

const UpdateSchema = z.strictObject({
  /** A service is "due" from this many days before its renewal date. */
  dueSoonDays: z.number().optional(),
  /** It lapses once the renewal date is this many days past. */
  graceDays: z.number().optional(),
});

// The renewal window and the lapse grace (FIG-1051). Management changes them; the states follow on the next read.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getRenewalSettings(ctx);
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, UpdateSchema);
    return updateRenewalSettings(ctx, body);
  });
}
