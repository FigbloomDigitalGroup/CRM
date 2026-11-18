import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { getAttachmentDownload } from "@/services/attachmentService";

// A short-lived signed download link, issued after the check that the caller may open the record.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; attachmentId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, attachmentId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const { download, file } = await getAttachmentDownload(ctx, attachmentId);
    return { download, file: { id: file.id, name: file.name, sizeBytes: file.sizeBytes, mimeType: file.mimeType } };
  });
}
