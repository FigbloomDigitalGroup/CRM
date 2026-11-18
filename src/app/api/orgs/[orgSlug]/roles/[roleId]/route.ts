import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveGatedContext } from "@/app/api/_lib/gatedContext";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { archiveRole, getRole, updateRole } from "@/services/roleEditorService";

const UpdateRoleSchema = z.strictObject({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  permissionKeys: z.array(z.string()).optional(),
  fieldRules: z.record(z.string(), z.string()).optional(),
});

type Params = { params: Promise<{ orgSlug: string; roleId: string }> };

export async function GET(_request: Request, { params }: Params) {
  return handleRoute(async () => {
    const { orgSlug, roleId } = await params;
    return getRole(await resolveGatedContext(orgSlug, "release.v2"), roleId);
  });
}

export async function PATCH(request: Request, { params }: Params) {
  return handleRoute(async () => {
    const { orgSlug, roleId } = await params;
    const ctx = await resolveGatedContext(orgSlug, "release.v2");
    return updateRole(ctx, roleId, await parseJsonBody(request, UpdateRoleSchema));
  });
}

// Archives a custom role nobody holds any more (FIG-1188).
export async function DELETE(_request: Request, { params }: Params) {
  return handleRoute(async () => {
    const { orgSlug, roleId } = await params;
    await archiveRole(await resolveGatedContext(orgSlug, "release.v2"), roleId);
    return { archived: true };
  });
}
