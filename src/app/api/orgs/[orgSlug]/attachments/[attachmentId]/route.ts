import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { deleteAttachment } from "@/services/attachmentService";

// Removes an attachment: the uploader or Management. The bytes are purged after the retention period.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; attachmentId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, attachmentId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return deleteAttachment(ctx, attachmentId);
  });
}
