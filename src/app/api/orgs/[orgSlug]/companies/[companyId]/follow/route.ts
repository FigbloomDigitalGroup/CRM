import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { followRecord, unfollowRecord } from "@/services/commentService";

// Follow or unfollow this company; followers are told about new comments (FIG-1044).
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; companyId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, companyId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return followRecord(ctx, "company", companyId);
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; companyId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, companyId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return unfollowRecord(ctx, "company", companyId);
  });
}
