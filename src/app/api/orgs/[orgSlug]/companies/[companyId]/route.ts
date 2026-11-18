import { flattenTags } from "@/repositories/tags";
import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { getCompany, updateCompany } from "@/services/companyService";

const UpdateCompanySchema = z.object({
  /** Organisation-defined custom field values (FIG-803); a field sent as null is cleared. */
  customFields: z.record(z.string(), z.any()).optional(),
  name: z.string().min(1).optional(),
  industry: z.string().optional(),
  website: z.string().optional(),
  location: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  notes: z.string().optional(),
  lifecycleStateId: z.string().nullable().optional(),
  ownerMembershipId: z.string().nullable().optional(),
});

type RouteParams = { params: Promise<{ orgSlug: string; companyId: string }> };

export async function GET(request: Request, { params }: RouteParams) {
  return handleRoute(async () => {
    const { orgSlug, companyId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return flattenTags(await getCompany(ctx, companyId));
  });
}

export async function PATCH(request: Request, { params }: RouteParams) {
  return handleRoute(async () => {
    const { orgSlug, companyId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, UpdateCompanySchema);
    return updateCompany(ctx, companyId, body);
  });
}
