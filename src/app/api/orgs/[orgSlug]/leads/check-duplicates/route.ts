import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { checkDuplicates } from "@/services/duplicateService";
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
    const possibleDuplicates = await checkDuplicateLeads(ctx, body);
    const found = await checkDuplicates(ctx, { entity: "lead", companyId: body.companyId });
    return { possibleDuplicates, duplicates: found.candidates, hiddenDuplicates: found.hiddenCount };
  });
}
