import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, parseQueryParams, requiredString } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { createCompany, listCompanies } from "@/services/companyService";

const ListCompaniesQuerySchema = z.object({
  q: z.string().optional(),
  ownerMembershipId: z.string().optional(),
  includeArchived: z.enum(["true", "false"]).optional(),
});

const CreateCompanySchema = z.object({
  name: requiredString("name is required."),
  industry: z.string().optional(),
  website: z.string().optional(),
  location: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  notes: z.string().optional(),
  lifecycleStateId: z.string().optional(),
  ownerMembershipId: z.string().optional(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const { searchParams } = new URL(request.url);
    const query = parseQueryParams(searchParams, ListCompaniesQuerySchema);
    return listCompanies(ctx, {
      query: query.q,
      ownerMembershipId: query.ownerMembershipId,
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
    const body = await parseJsonBody(request, CreateCompanySchema);
    return createCompany(ctx, body);
  });
}
