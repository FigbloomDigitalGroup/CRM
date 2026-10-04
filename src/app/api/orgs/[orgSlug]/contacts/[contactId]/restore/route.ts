import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { restoreContact } from "@/services/contactService";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; contactId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, contactId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return restoreContact(ctx, contactId);
  });
}
