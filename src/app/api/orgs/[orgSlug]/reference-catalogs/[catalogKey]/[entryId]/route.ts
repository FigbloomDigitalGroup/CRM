import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, validateData } from "@/app/api/_lib/validation";
import { ValidationError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import { isCatalogKey } from "@/repositories/referenceCatalogs";
import { setCatalogEntryActive, updateCatalogEntry } from "@/services/referenceCatalogService";

const ToggleActiveSchema = z.object({ isActive: z.boolean() });

const UpdateCatalogEntrySchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  probability: z.number().nullable().optional(),
  isWon: z.boolean().optional(),
  isLost: z.boolean().optional(),
  category: z.string().nullable().optional(),
});

function requireCatalogKey(raw: string) {
  if (!isCatalogKey(raw)) {
    throw new ValidationError(`Unknown reference catalog "${raw}".`);
  }
  return raw;
}

/**
 * One endpoint for both "rename/edit" and "deactivate/reactivate" --
 * `isActive` is just another optional field in the body, same shape as
 * `company-services/[companyServiceId]/route.ts`'s status update. The
 * body's raw shape decides which of the two schemas applies, so it's
 * parsed generically first and validated a second time (`validateData`)
 * against whichever one fits.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; catalogKey: string; entryId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, catalogKey, entryId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const key = requireCatalogKey(catalogKey);
    const raw = await parseJsonBody(request, z.record(z.string(), z.unknown()));

    if (typeof raw.isActive === "boolean" && Object.keys(raw).length === 1) {
      const { isActive } = validateData(raw, ToggleActiveSchema);
      return setCatalogEntryActive(ctx, key, entryId, isActive);
    }
    const body = validateData(raw, UpdateCatalogEntrySchema);
    return updateCatalogEntry(ctx, key, entryId, body);
  });
}
