import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { getLead, updateLead } from "@/services/leadService";

const UpdateLeadSchema = z.object({
  leadStatusId: z.string().min(1).optional(),
  companyId: z.string().nullable().optional(),
  contactId: z.string().nullable().optional(),
  leadSourceId: z.string().nullable().optional(),
  temperature: z.enum(["HOT", "WARM", "COLD"]).optional(),
  serviceInterestId: z.string().nullable().optional(),
  qualificationData: z.any().optional(),
  lostReasonId: z.string().nullable().optional(),
  nextFollowUpAt: z.coerce.date().nullable().optional(),
  notes: z.string().nullable().optional(),
});

type RouteParams = { params: Promise<{ orgSlug: string; leadId: string }> };

export async function GET(request: Request, { params }: RouteParams) {
  return handleRoute(async () => {
    const { orgSlug, leadId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getLead(ctx, leadId);
  });
}

export async function PATCH(request: Request, { params }: RouteParams) {
  return handleRoute(async () => {
    const { orgSlug, leadId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, UpdateLeadSchema);
    return updateLead(ctx, leadId, body);
  });
}
