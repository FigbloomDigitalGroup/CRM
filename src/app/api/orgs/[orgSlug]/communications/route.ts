import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, requiredString } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { ValidationError } from "@/auth/errors";
import {
  createCommunication,
  listCommunicationsForCompany,
  listCommunicationsForContact,
  listCommunicationsForDeal,
  listCommunicationsForLead,
} from "@/services/communicationService";

const CreateCommunicationSchema = z.object({
  channel: z.enum(["EMAIL", "PHONE", "WHATSAPP", "SMS", "MEETING", "SOCIAL", "OTHER"]),
  direction: z.enum(["INBOUND", "OUTBOUND"]),
  occurredAt: z.coerce.date().optional(),
  subject: z.string().optional(),
  summary: requiredString("summary is required."),
  externalReference: z.string().optional(),
  activityId: z.string().optional(),
  companyId: z.string().optional(),
  contactId: z.string().optional(),
  leadId: z.string().optional(),
  dealId: z.string().optional(),
});

/**
 * Same "exactly one parent, not combined" convention as
 * `activities/route.ts` -- see that file's comment for why.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const { searchParams } = new URL(request.url);

    const companyId = searchParams.get("companyId");
    const contactId = searchParams.get("contactId");
    const leadId = searchParams.get("leadId");
    const dealId = searchParams.get("dealId");

    if (companyId) return listCommunicationsForCompany(ctx, companyId);
    if (contactId) return listCommunicationsForContact(ctx, contactId);
    if (leadId) return listCommunicationsForLead(ctx, leadId);
    if (dealId) return listCommunicationsForDeal(ctx, dealId);
    throw new ValidationError(
      "One of companyId, contactId, leadId, or dealId is required.",
    );
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, CreateCommunicationSchema);
    return createCommunication(ctx, body);
  });
}
