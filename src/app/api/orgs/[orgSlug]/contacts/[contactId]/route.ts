import { flattenTags } from "@/repositories/tags";
import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { getContact, updateContact } from "@/services/contactService";

const UpdateContactSchema = z.object({
  /** Organisation-defined custom field values (FIG-803); a field sent as null is cleared. */
  customFields: z.record(z.string(), z.any()).optional(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().optional(),
  companyId: z.string().nullable().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  jobTitle: z.string().optional(),
  department: z.string().optional(),
  notes: z.string().optional(),
  ownerMembershipId: z.string().nullable().optional(),
});

type RouteParams = { params: Promise<{ orgSlug: string; contactId: string }> };

export async function GET(request: Request, { params }: RouteParams) {
  return handleRoute(async () => {
    const { orgSlug, contactId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return flattenTags(await getContact(ctx, contactId));
  });
}

export async function PATCH(request: Request, { params }: RouteParams) {
  return handleRoute(async () => {
    const { orgSlug, contactId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, UpdateContactSchema);
    return updateContact(ctx, contactId, body);
  });
}
