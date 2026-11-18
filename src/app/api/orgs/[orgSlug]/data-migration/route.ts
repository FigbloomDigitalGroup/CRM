import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { listMigrationEntities } from "@/services/migrationService";

// Data migration (FIG-1061, B4.04, S7): what can be migrated, the fields of each kind, the seven steps. Management only.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return listMigrationEntities(ctx);
  });
}
