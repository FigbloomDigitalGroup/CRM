import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { pageQueryShape, toPageRequest } from "@/app/api/_lib/pageQuery";
import { parseJsonBody, parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { withIdempotency } from "@/lib/idempotency";
import { createCatalogueEntry, listCatalogue } from "@/services/catalogueService";

const ListQuerySchema = z.object({
  status: z.string().optional(),
  kind: z.string().optional(),
  q: z.string().optional(),
  ...pageQueryShape,
});

const Money = z.union([z.number(), z.string()]);
const CreateSchema = z.strictObject({
  name: z.string({ error: "name is required." }),
  price: Money,
  sku: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  kind: z.string().optional(),
  unit: z.string().optional(),
  /** Needs `deals.margin`. */
  cost: Money.nullable().optional(),
  currency: z.string().optional(),
  taxable: z.boolean().optional(),
  status: z.string().optional(),
});

// The product and service catalogue (FIG-1142, B6.10, V1.1). Cost and margin are null without `deals.margin`.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, ListQuerySchema);
    return listCatalogue(ctx, { status: query.status, kind: query.kind, q: query.q }, toPageRequest(query));
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, CreateSchema);
    return withIdempotency(ctx, request, body, () => createCatalogueEntry(ctx, body));
  });
}
