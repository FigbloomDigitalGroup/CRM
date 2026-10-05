import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, parseQueryParams, requiredString } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { createLead, listLeads } from "@/services/leadService";

const TemperatureEnum = z.enum(["HOT", "WARM", "COLD"]);

const ListLeadsQuerySchema = z.object({
  q: z.string().optional(),
  ownerMembershipId: z.string().optional(),
  leadStatusId: z.string().optional(),
  leadSourceId: z.string().optional(),
  temperature: TemperatureEnum.optional(),
  includeArchived: z.enum(["true", "false"]).optional(),
});

const CreateLeadSchema = z.object({
  leadStatusId: requiredString("leadStatusId is required."),
  companyId: z.string().optional(),
  contactId: z.string().optional(),
  leadSourceId: z.string().optional(),
  temperature: TemperatureEnum.optional(),
  serviceInterestId: z.string().optional(),
  ownerMembershipId: z.string().optional(),
  // Arbitrary per-status qualification answers -- no fixed shape to
  // validate against (z.any, not z.unknown, so this stays assignable to
  // Prisma's InputJsonValue without a cast).
  qualificationData: z.any().optional(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const { searchParams } = new URL(request.url);
    const query = parseQueryParams(searchParams, ListLeadsQuerySchema);
    return listLeads(ctx, {
      query: query.q,
      ownerMembershipId: query.ownerMembershipId,
      leadStatusId: query.leadStatusId,
      leadSourceId: query.leadSourceId,
      temperature: query.temperature,
      includeArchived: query.includeArchived === "true",
    });
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, CreateLeadSchema);
    return createLead(ctx, body);
  });
}
