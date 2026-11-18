import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { listMigrationPresets, saveMigrationPreset } from "@/services/migrationService";

const SaveSchema = z.strictObject({
  name: z.string({ error: "name is required." }),
  entity: z.string({ error: "entity is required." }),
  mapping: z.record(z.string(), z.string()),
  valueMappings: z.record(z.string(), z.record(z.string(), z.string())).optional(),
});

// Saved mappings, to start the next migration from. Saving under an existing name updates it.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, z.object({ entity: z.string().optional() }));
    return listMigrationPresets(ctx, query.entity);
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return saveMigrationPreset(ctx, await parseJsonBody(request, SaveSchema));
  });
}
