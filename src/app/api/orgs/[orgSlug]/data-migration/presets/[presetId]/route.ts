import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { deleteMigrationPreset } from "@/services/migrationService";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; presetId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, presetId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return deleteMigrationPreset(ctx, presetId);
  });
}
