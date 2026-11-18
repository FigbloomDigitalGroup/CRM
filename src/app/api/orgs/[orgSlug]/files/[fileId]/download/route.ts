import { handleRoute } from "@/app/api/_lib/handleRoute";
import { DownloadLinkResponseSchema, toFileDto } from "@/api/dto/files";
import { respond } from "@/api/respond";
import { resolveRequestContext } from "@/auth/requestContext";
import { getDownloadLink } from "@/services/fileService";

// A short-lived signed download link, issued after an authorisation check on
// this call. A quarantined file answers 409 and gets no link.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; fileId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, fileId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const { file, download } = await getDownloadLink(ctx, fileId);
    return respond(DownloadLinkResponseSchema, { file: toFileDto(file), download });
  });
}
