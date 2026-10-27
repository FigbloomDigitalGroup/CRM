import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { updateRetention } from "@/services/privacyService";

// A period per kind of data: a number, null to keep it until decided otherwise, or "DEFAULT" for the documented default.
const Schema = z.record(z.string(), z.union([z.number(), z.null(), z.literal("DEFAULT")]));

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> } ,
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return updateRetention(ctx, await parseJsonBody(request, Schema));
  });
}
