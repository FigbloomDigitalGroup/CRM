import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { checkDuplicateCompanies } from "@/services/companyService";
import { checkDuplicates } from "@/services/duplicateService";

const CheckDuplicateCompaniesSchema = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, CheckDuplicateCompaniesSchema);
    const possibleDuplicates = await checkDuplicateCompanies(ctx, body);
    const found = await checkDuplicates(ctx, { entity: "company", companyName: body.name, email: body.email, phone: body.phone });
    return { possibleDuplicates, duplicates: found.candidates, hiddenDuplicates: found.hiddenCount };
  });
}
