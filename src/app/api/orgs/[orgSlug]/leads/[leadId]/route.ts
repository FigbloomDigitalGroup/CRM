import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { getLead, updateLead } from "@/services/leadService";
import { findOrAddServiceForLead } from "@/services/referenceAdminService";

const UpdateLeadSchema = z.object({
  /** Organisation-defined custom field values (FIG-803); a field sent as null is cleared. */
  customFields: z.record(z.string(), z.any()).optional(),
  leadStatusId: z.string().min(1).optional(),
  companyId: z.string().nullable().optional(),
  contactId: z.string().nullable().optional(),
  leadSourceId: z.string().nullable().optional(),
  temperature: z.enum(["HOT", "WARM", "COLD"]).optional(),
  serviceInterestId: z.string().nullable().optional(),
  /** A service typed by the person: the one with that name is used, or it is added to the list. */
  serviceInterestName: z.string().max(80).optional(),
  qualificationData: z.any().optional(),
  lostReasonId: z.string().nullable().optional(),
  /** A full ISO date and time. A date-only value (older clients, imports) is accepted and means the default follow-up time (09:00) in the viewer's time zone. */
  nextFollowUpAt: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.coerce.date()]).nullable().optional(),
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
    const { serviceInterestName, ...rest } = body;
    const patch = serviceInterestName?.trim() ? { ...rest, serviceInterestId: await findOrAddServiceForLead(ctx, serviceInterestName) } : rest;
    return updateLead(ctx, leadId, patch);
  });
}
