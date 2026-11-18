import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseOptionalJsonBody } from "@/app/api/_lib/validation";
import { ArchiveBodySchema } from "@/api/dto/common";
import { resolveRequestContext } from "@/auth/requestContext";
import { archiveDeal } from "@/services/dealService";

// Soft-delete with an optional reason (FIG-1045, B2.16).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; dealId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, dealId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseOptionalJsonBody(request, ArchiveBodySchema);
    return archiveDeal(ctx, dealId, body);
  });
}
