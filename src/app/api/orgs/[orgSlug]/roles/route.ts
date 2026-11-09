import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveGatedContext } from "@/app/api/_lib/gatedContext";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { withIdempotency } from "@/lib/idempotency";
import { createRole, listRoles } from "@/services/roleEditorService";

const CreateRoleSchema = z.strictObject({
  name: z.string({ error: "name is required." }),
  description: z.string().nullable().optional(),
  basedOnRoleKey: z.string().optional(),
  permissionKeys: z.array(z.string()).optional(),
  fieldRules: z.record(z.string(), z.string()).optional(),
});

// Roles and field access (FIG-1188, B7.06): the platform roles and this organisation's custom roles. V2; Management writes (roles.manage).
export async function GET(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveGatedContext(orgSlug, "release.v2");
    return listRoles(ctx, { includeArchived: new URL(request.url).searchParams.get("includeArchived") === "true" });
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveGatedContext(orgSlug, "release.v2"); // release gate before body validation
    const body = await parseJsonBody(request, CreateRoleSchema);
    return withIdempotency(ctx, request, body, () => createRole(ctx, body));
  });
}
