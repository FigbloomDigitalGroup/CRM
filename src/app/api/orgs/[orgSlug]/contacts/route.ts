import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, parseQueryParams, requiredString } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { createContact, listContacts } from "@/services/contactService";

const ListContactsQuerySchema = z.object({
  q: z.string().optional(),
  companyId: z.string().optional(),
  ownerMembershipId: z.string().optional(),
  includeArchived: z.enum(["true", "false"]).optional(),
});

const CreateContactSchema = z.object({
  firstName: requiredString("firstName is required."),
  lastName: z.string().optional(),
  companyId: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  jobTitle: z.string().optional(),
  department: z.string().optional(),
  notes: z.string().optional(),
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
    const query = parseQueryParams(searchParams, ListContactsQuerySchema);
    return listContacts(ctx, {
      query: query.q,
      companyId: query.companyId,
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
    const body = await parseJsonBody(request, CreateContactSchema);
    return createContact(ctx, body);
  });
}
