import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { fulfilRectificationRequest } from "@/services/privacyService";

const Schema = z.strictObject({ firstName: z.string().optional(), lastName: z.string().nullable().optional(), email: z.string().nullable().optional(), phone: z.string().nullable().optional(), jobTitle: z.string().nullable().optional(), department: z.string().nullable().optional(), notes: z.string().nullable().optional() });

// Apply the corrections to the person's record (audited on the record) and complete the request.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; requestId: string }> } ,
) {
  return handleRoute(async () => {
    const { orgSlug, requestId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return fulfilRectificationRequest(ctx, requestId, await parseJsonBody(request, Schema));
  });
}
