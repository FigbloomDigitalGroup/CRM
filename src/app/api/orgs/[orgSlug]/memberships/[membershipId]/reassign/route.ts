import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, requiredString } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { REASSIGNMENT_KINDS, reassignMemberRecords } from "@/services/reassignmentService";

const ReassignSchema = z.object({
  toMembershipId: requiredString("toMembershipId is required."),
  kinds: z.array(z.enum(REASSIGNMENT_KINDS)).optional(),
});

/** Hands a member's open records to another active member (B1.05). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; membershipId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, membershipId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, ReassignSchema);
    return reassignMemberRecords(ctx, membershipId, body);
  });
}
