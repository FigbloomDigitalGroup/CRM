import { handleRoute } from "@/app/api/_lib/handleRoute";
import { FileSchema, toFileDto } from "@/api/dto/files";
import { respond } from "@/api/respond";
import { resolveRequestContext } from "@/auth/requestContext";
import { deleteFile, getFile } from "@/services/fileService";

type RouteParams = { params: Promise<{ orgSlug: string; fileId: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  return handleRoute(async () => {
    const { orgSlug, fileId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return respond(FileSchema, toFileDto(await getFile(ctx, fileId)));
  });
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  return handleRoute(async () => {
    const { orgSlug, fileId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return respond(FileSchema, toFileDto(await deleteFile(ctx, fileId)));
  });
}
