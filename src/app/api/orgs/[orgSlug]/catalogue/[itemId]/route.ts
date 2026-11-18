import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { getCatalogueEntry, updateCatalogueEntry } from "@/services/catalogueService";

const Money = z.union([z.number(), z.string()]);
const UpdateSchema = z.strictObject({
  name: z.string().optional(),
  price: Money.optional(),
  sku: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  kind: z.string().optional(),
  unit: z.string().optional(),
  cost: Money.nullable().optional(),
  currency: z.string().optional(),
  taxable: z.boolean().optional(),
  /** ACTIVE or HIDDEN. */
  status: z.string().optional(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; itemId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, itemId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getCatalogueEntry(ctx, itemId);
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; itemId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, itemId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, UpdateSchema);
    return updateCatalogueEntry(ctx, itemId, body);
  });
}
