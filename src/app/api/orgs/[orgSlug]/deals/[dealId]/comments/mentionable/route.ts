import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { listMentionableMembers } from "@/services/commentService";

// Who may be mentioned on this deal: the members who can open it (FIG-1044).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; dealId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, dealId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return { members: await listMentionableMembers(ctx, "deal", dealId) };
  });
}
