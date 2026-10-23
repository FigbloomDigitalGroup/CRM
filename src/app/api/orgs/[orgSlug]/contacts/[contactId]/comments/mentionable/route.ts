import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { listMentionableMembers } from "@/services/commentService";

// Who may be mentioned on this contact: the members who can open it (FIG-1044).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; contactId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, contactId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return { members: await listMentionableMembers(ctx, "contact", contactId) };
  });
}
