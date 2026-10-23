import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { listMentionableMembers } from "@/services/commentService";

// Who may be mentioned on this company: the members who can open it (FIG-1044).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; companyId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, companyId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return { members: await listMentionableMembers(ctx, "company", companyId) };
  });
}
