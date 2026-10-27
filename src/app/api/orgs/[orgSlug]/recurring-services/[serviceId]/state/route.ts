import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { overrideRenewalState } from "@/services/recurringServiceService";

const OverrideSchema = z.strictObject({
  /** The state a person decides, or null to hand it back to the dates. */
  state: z.enum(["ACTIVE", "DUE_SOON", "LAPSED", "STARTS_LATER"]).nullable(),
  /** Required whenever a state is set. */
  reason: z.string().optional(),
});

// A person's override of the renewal state, always with a reason (FIG-1051).
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; serviceId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, serviceId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, OverrideSchema);
    return overrideRenewalState(ctx, serviceId, body);
  });
}
