import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { pageQueryShape, toPageRequest } from "@/app/api/_lib/pageQuery";
import { parseJsonBody, parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { withIdempotency } from "@/lib/idempotency";
import { createMigrationSession, listMigrationSessions } from "@/services/migrationService";

const CreateSchema = z.strictObject({
  entity: z.string({ error: "entity is required." }),
  sourceKind: z.enum(["TEMPLATE", "GENERIC"]).optional(),
  presetId: z.string().optional(),
  duplicatePolicy: z.enum(["SKIP", "UPDATE", "CREATE"]).optional(),
  createMissingCompanies: z.boolean().optional(),
});
const ListSchema = z.object({ entity: z.string().optional(), status: z.string().optional(), ...pageQueryShape });

// Step 1 (choose the source): start a migration session for one kind of record.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, CreateSchema);
    return withIdempotency(ctx, request, body, () => createMigrationSession(ctx, body));
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, ListSchema);
    return listMigrationSessions(ctx, { entity: query.entity, status: query.status, paging: toPageRequest(query) });
  });
}
