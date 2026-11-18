import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { completeAttachment } from "@/services/attachmentService";

// After the bytes are uploaded: the file is checked and scanned, then becomes available.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; attachmentId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, attachmentId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const { file, ...rest } = await completeAttachment(ctx, attachmentId);
    return { ...rest, file: { id: file.id, name: file.name, sizeBytes: file.sizeBytes, mimeType: file.mimeType, status: file.status } };
  });
}
