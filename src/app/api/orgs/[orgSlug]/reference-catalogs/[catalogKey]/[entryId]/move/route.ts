import { handleRoute } from "@/app/api/_lib/handleRoute";
import { ValidationError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import { isCatalogKey } from "@/repositories/referenceCatalogs";
import { reorderCatalogEntry } from "@/services/referenceCatalogService";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; catalogKey: string; entryId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, catalogKey, entryId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    if (!isCatalogKey(catalogKey)) {
      throw new ValidationError(`Unknown reference catalog "${catalogKey}".`);
    }
    const body = await request.json();
    if (body.direction !== "up" && body.direction !== "down") {
      throw new ValidationError('direction must be "up" or "down".');
    }
    await reorderCatalogEntry(ctx, catalogKey, entryId, body.direction);
    return { ok: true };
  });
}
