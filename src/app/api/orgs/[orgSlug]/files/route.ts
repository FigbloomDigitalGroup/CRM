import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { CreateUploadBodySchema, CreateUploadResponseSchema, toFileDto } from "@/api/dto/files";
import { respond } from "@/api/respond";
import { resolveRequestContext } from "@/auth/requestContext";
import { createUpload } from "@/services/fileService";

// Start an upload (FIG-1023, B1.07): records the file and returns a short-lived
// signed link to send the bytes to. The file is not usable until it is completed.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, CreateUploadBodySchema);
    const { file, upload } = await createUpload(ctx, body);
    return respond(CreateUploadResponseSchema, { file: toFileDto(file), upload });
  });
}
