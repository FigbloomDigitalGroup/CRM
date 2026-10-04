import { handleRoute } from "@/app/api/_lib/handleRoute";
import { ValidationError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import { isCatalogKey } from "@/repositories/referenceCatalogs";
import { setCatalogEntryActive, updateCatalogEntry } from "@/services/referenceCatalogService";

function requireCatalogKey(raw: string) {
  if (!isCatalogKey(raw)) {
    throw new ValidationError(`Unknown reference catalog "${raw}".`);
  }
  return raw;
}

/**
 * One endpoint for both "rename/edit" and "deactivate/reactivate" --
 * `isActive` is just another optional field in the body, same shape as
 * `company-services/[companyServiceId]/route.ts`'s status update.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; catalogKey: string; entryId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, catalogKey, entryId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const key = requireCatalogKey(catalogKey);
    const body = await request.json();

    if (typeof body.isActive === "boolean" && Object.keys(body).length === 1) {
      return setCatalogEntryActive(ctx, key, entryId, body.isActive);
    }
    return updateCatalogEntry(ctx, key, entryId, body);
  });
}
