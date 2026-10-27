import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { getLifecycle, releaseLifecycleOverride, setLifecycleStateManually } from "@/services/lifecycleService";

const SetSchema = z.strictObject({
  stateId: z.string().optional(),
  stateKey: z.string().optional(),
  /** Required: a person's override always says why. */
  reason: z.string({ error: "reason is required." }),
});

// The lifecycle state of a company and its history (FIG-1048).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; companyId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, companyId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getLifecycle(ctx, companyId);
  });
}

// A permitted person sets the state by hand, with a reason; the daily job leaves it alone until released.
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; companyId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, companyId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, SetSchema);
    return setLifecycleStateManually(ctx, companyId, body);
  });
}

// Hands the company back to the rules.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; companyId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, companyId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return releaseLifecycleOverride(ctx, companyId);
  });
}
