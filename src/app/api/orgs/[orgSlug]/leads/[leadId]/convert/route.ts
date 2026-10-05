import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, requiredString } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { convertLead } from "@/services/leadService";

const NewCompanySchema = z.object({
  name: requiredString("newCompany.name is required."),
  industry: z.string().optional(),
  website: z.string().optional(),
  location: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  notes: z.string().optional(),
});

const NewContactSchema = z.object({
  firstName: requiredString("newContact.firstName is required."),
  lastName: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  jobTitle: z.string().optional(),
  department: z.string().optional(),
});

const ConvertLeadSchema = z.object({
  companyId: z.string().optional(),
  newCompany: NewCompanySchema.optional(),
  newContact: NewContactSchema.optional(),
  ownerMembershipId: z.string().optional(),
  pipelineStageId: z.string().optional(),
  serviceId: z.string().optional(),
  value: z.union([z.number(), z.string()]).optional(),
  expectedCloseDate: z.string().optional(),
  notes: z.string().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; leadId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, leadId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, ConvertLeadSchema);
    return convertLead(ctx, leadId, body);
  });
}
