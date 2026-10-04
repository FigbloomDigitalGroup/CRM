import { handleRoute } from "@/app/api/_lib/handleRoute";
import { ValidationError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import { isCatalogKey } from "@/repositories/referenceCatalogs";
import { createCatalogEntry, listCatalog } from "@/services/referenceCatalogService";

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
    const body = await request.json();
    return createCatalogEntry(ctx, requireCatalogKey(catalogKey), body);
  });
}
