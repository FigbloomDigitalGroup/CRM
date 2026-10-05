import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { checkDuplicateLeads } from "@/services/leadService";

const CheckDuplicateLeadsSchema = z.object({
  contactEmail: z.string().optional(),
  contactPhone: z.string().optional(),
  companyId: z.string().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, CheckDuplicateLeadsSchema);
    return { possibleDuplicates: await checkDuplicateLeads(ctx, body) };
  });
}
