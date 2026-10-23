import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { updateCustomFieldDefinition } from "@/services/customFieldService";

const PatchSchema = z.strictObject({
  label: z.string().optional(),
  options: z.array(z.strictObject({ value: z.string(), label: z.string() })).optional(),
  helpText: z.string().max(300).nullable().optional(),
  required: z.boolean().optional(),
  requiredOnQualify: z.boolean().optional(),
  serviceId: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

// The key and the type of a field are fixed; retire a field with isActive: false instead of deleting it.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; fieldId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, fieldId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, PatchSchema);
    return updateCustomFieldDefinition(ctx, fieldId, body);
  });
}
