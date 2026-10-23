import { handleRoute } from "@/app/api/_lib/handleRoute";
import { FileSchema, toFileDto } from "@/api/dto/files";
import { respond } from "@/api/respond";
import { resolveRequestContext } from "@/auth/requestContext";
import { completeUpload } from "@/services/fileService";

// After the bytes are uploaded: checks size, type, content and checksum, runs
// the malware scan and makes the file READY (or quarantines / refuses it).
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; fileId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, fileId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return respond(FileSchema, toFileDto(await completeUpload(ctx, fileId)));
  });
}
