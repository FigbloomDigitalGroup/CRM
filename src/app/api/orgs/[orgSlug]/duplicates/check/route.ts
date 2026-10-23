import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { DuplicateResultSchema } from "@/api/dto/common";
import { respond } from "@/api/respond";
import { resolveRequestContext } from "@/auth/requestContext";
import { checkDuplicates } from "@/services/duplicateService";

const CheckDuplicatesBodySchema = z.strictObject({
  entity: z.enum(["lead", "contact", "company"]),
  companyName: z.string().max(200).nullish(),
  firstName: z.string().max(100).nullish(),
  lastName: z.string().max(100).nullish(),
  email: z.string().max(200).nullish(),
  phone: z.string().max(40).nullish(),
  website: z.string().max(300).nullish(),
  companyId: z.string().nullish(),
  contactId: z.string().nullish(),
  excludeId: z.string().nullish(),
});

// One duplicate check for create forms, import rows, quick capture and the merge screen (FIG-1033, B2.04).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, CheckDuplicatesBodySchema);
    return respond(DuplicateResultSchema, await checkDuplicates(ctx, body));
  });
}
