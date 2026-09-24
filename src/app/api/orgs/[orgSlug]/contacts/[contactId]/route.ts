import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { getContact, updateContact } from "@/services/contactService";

type RouteParams = { params: Promise<{ orgSlug: string; contactId: string }> };

export async function GET(request: Request, { params }: RouteParams) {
  return handleRoute(async () => {
    const { orgSlug, contactId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getContact(ctx, contactId);
  });
}

export async function PATCH(request: Request, { params }: RouteParams) {
  return handleRoute(async () => {
    const { orgSlug, contactId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await request.json();
    return updateContact(ctx, contactId, body);
  });
}
