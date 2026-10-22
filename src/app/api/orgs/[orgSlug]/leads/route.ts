import { handleRoute } from "@/app/api/_lib/handleRoute";
import { pageQueryShape, toPageRequest } from "@/app/api/_lib/pageQuery";
import { parseJsonBody, parseQueryParams } from "@/app/api/_lib/validation";
import {
  CreateLeadBodySchema,
  CreateLeadResponseSchema,
  LEAD_SORTS,
  ListLeadsQuerySchema,
  ListLeadsResponseSchema,
  toLeadDto,
} from "@/api/dto/leads";
import { respond } from "@/api/respond";
import { resolveRequestContext } from "@/auth/requestContext";
import { withIdempotency } from "@/lib/idempotency";
import { parseSort } from "@/lib/listQuery";
import { createLead, listLeadsPage } from "@/services/leadService";

// Reference implementation of the API conventions (FIG-1014, B0.06): schemas
// in `src/api/dto/leads.ts`, standard list query, checked response, standard
// error envelope, idempotent create. See `docs/API_CONVENTIONS.md`.

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const { searchParams } = new URL(request.url);
    const query = parseQueryParams(
      searchParams,
      ListLeadsQuerySchema.extend(pageQueryShape),
    );
    const page = await listLeadsPage(
      ctx,
      {
        query: query.q,
        ownerMembershipId: query.ownerMembershipId,
        leadStatusId: query.leadStatusId,
        leadSourceId: query.leadSourceId,
        temperature: query.temperature,
        includeArchived: query.includeArchived === "true",
        sort: parseSort(query.sort, LEAD_SORTS),
      },
      toPageRequest(query),
    );
    return respond(ListLeadsResponseSchema, {
      ...page,
      items: page.items.map((lead) => toLeadDto(ctx, lead)),
    });
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, CreateLeadBodySchema);
    return withIdempotency(ctx, request, body, async () =>
      respond(CreateLeadResponseSchema, await createLead(ctx, body)),
    );
  });
}
