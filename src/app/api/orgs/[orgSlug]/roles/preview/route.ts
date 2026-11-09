import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveGatedContext } from "@/app/api/_lib/gatedContext";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { previewRole } from "@/services/roleEditorService";

const PreviewSchema = z.strictObject({
  roleId: z.string().optional(),
  basedOnRoleKey: z.string().optional(),
  permissionKeys: z.array(z.string()).optional(),
  fieldRules: z.record(z.string(), z.string()).optional(),
});

// The effect of a role change before it is saved (FIG-1188). Writes nothing.
export async function POST(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveGatedContext(orgSlug, "release.v2");
    return previewRole(ctx, await parseJsonBody(request, PreviewSchema));
  });
}
