import { handleRoute } from "@/app/api/_lib/handleRoute";
import { ScoreViewSchema } from "@/api/dto/common";
import { respond } from "@/api/respond";
import { resolveRequestContext } from "@/auth/requestContext";
import { getCustomerHealth } from "@/services/scoreService";

// Customer health and why (FIG-1032, B2.03). Payment-based factors appear only for Finance and Management.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; companyId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, companyId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return respond(ScoreViewSchema, await getCustomerHealth(ctx, companyId));
  });
}
