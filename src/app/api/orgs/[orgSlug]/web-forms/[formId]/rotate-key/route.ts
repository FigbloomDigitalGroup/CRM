import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { rotateFormKey } from "@/services/webFormService";

// Issues a new public key for the form; the old one stops working at once, so the form must be embedded again.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; formId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, formId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return rotateFormKey(ctx, formId);
  });
}
