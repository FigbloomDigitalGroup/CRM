import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { setLegalHold } from "@/services/privacyService";

const Schema = z.strictObject({ active: z.boolean({ error: "active is required." }), reason: z.string().optional() });

// Place or release the legal hold. While it is on, the retention job purges nothing and nobody can be erased.
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> } ,
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return setLegalHold(ctx, await parseJsonBody(request, Schema));
  });
}
