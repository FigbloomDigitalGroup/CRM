import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { getHandoffView, updateHandoff } from "@/services/handoffService";

const UpdateHandoffSchema = z.strictObject({
  scope: z.string().nullable().optional(),
  requirements: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  deliverables: z.array(z.strictObject({ title: z.string(), done: z.boolean().optional() })).optional(),
  teamMembershipIds: z.array(z.string()).optional(),
  /** DELIVERED (the owner; Management when allowed), or ONBOARDING to reopen (Management). */
  status: z.enum(["ONBOARDING", "DELIVERED"]).optional(),
});

/**
 * The handoff recorded when this deal was won (FIG-792, FIG-1037), or `{ handoff: null }`
 * if it has not been won yet: status, owner, team, scope, requirements, deliverables,
 * the client profile, the onboarding tasks, and what the caller may do. Visibility
 * follows the deal itself, so Delivery sees a handoff only once the deal is won.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; dealId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, dealId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getHandoffView(ctx, dealId);
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; dealId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, dealId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, UpdateHandoffSchema);
    return updateHandoff(ctx, dealId, body);
  });
}
