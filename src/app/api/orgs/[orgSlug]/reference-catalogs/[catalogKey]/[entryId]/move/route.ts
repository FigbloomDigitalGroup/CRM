import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { ValidationError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import { isCatalogKey } from "@/repositories/referenceCatalogs";
import { reorderCatalogEntry } from "@/services/referenceCatalogService";

const MoveCatalogEntrySchema = z.object({
  direction: z.enum(["up", "down"], {
    message: 'direction must be "up" or "down".',
  }),
});

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
    const body = await parseJsonBody(request, MoveCatalogEntrySchema);
    await reorderCatalogEntry(ctx, catalogKey, entryId, body.direction);
    return { ok: true };
  });
}
