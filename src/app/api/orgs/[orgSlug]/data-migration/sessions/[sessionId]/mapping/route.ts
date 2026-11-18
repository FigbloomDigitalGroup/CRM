import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { setMigrationMapping } from "@/services/migrationService";

const MappingSchema = z.strictObject({
  mapping: z.record(z.string(), z.string()).optional(),
  valueMappings: z.record(z.string(), z.record(z.string(), z.string())).optional(),
  duplicatePolicy: z.enum(["SKIP", "UPDATE", "CREATE"]).optional(),
  createMissingCompanies: z.boolean().optional(),
  savePresetAs: z.string().optional(),
  presetId: z.string().nullable().optional(),
});

// Step 3 (map fields): field to column, value mappings (statuses, sources, services, owners by email), the duplicate policy. Resets earlier results.
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; sessionId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, sessionId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return setMigrationMapping(ctx, sessionId, await parseJsonBody(request, MappingSchema));
  });
}
