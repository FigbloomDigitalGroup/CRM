import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { ValidationError } from "@/auth/errors";
import {
  createCommunication,
  listCommunicationsForCompany,
  listCommunicationsForContact,
  listCommunicationsForDeal,
  listCommunicationsForLead,
} from "@/services/communicationService";

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
    const body = await request.json();
    return createCommunication(ctx, body);
  });
}
