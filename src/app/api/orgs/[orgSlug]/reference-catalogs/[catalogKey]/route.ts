import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, requiredString } from "@/app/api/_lib/validation";
import { ValidationError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import { isCatalogKey } from "@/repositories/referenceCatalogs";
import { createCatalogEntry, listCatalog } from "@/services/referenceCatalogService";

const CreateCatalogEntrySchema = z.object({
  name: requiredString("name is required."),
  description: z.string().optional(),
  probability: z.number().optional(),
  isWon: z.boolean().optional(),
  isLost: z.boolean().optional(),
  category: z.string().optional(),
});

function requireCatalogKey(raw: string) {
  if (!isCatalogKey(raw)) {
    throw new ValidationError(`Unknown reference catalog "${raw}".`);
  }
  return raw;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; catalogKey: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, catalogKey } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return listCatalog(ctx, requireCatalogKey(catalogKey));
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; catalogKey: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, catalogKey } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, CreateCatalogEntrySchema);
    return createCatalogEntry(ctx, requireCatalogKey(catalogKey), body);
  });
}
