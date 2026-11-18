import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveGatedContext } from "@/app/api/_lib/gatedContext";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { withIdempotency } from "@/lib/idempotency";
import { createSupportRequest } from "@/services/supportRequestService";

const CreateSchema = z.strictObject({
  subject: z.string({ error: "subject is required." }),
  message: z.string({ error: "message is required." }),
  category: z.string().optional(),
  urgency: z.string().optional(),
  pagePath: z.string().nullable().optional(),
});

// Ask Figbloom for help by email (docs/SUPPORT_BY_EMAIL.md, V1.1). Any active member of any role; the request goes out through Resend.
export async function POST(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const ctx = await resolveGatedContext((await params).orgSlug, "release.v11");
    const body = await parseJsonBody(request, CreateSchema);
    return withIdempotency(ctx, request, body, () => createSupportRequest(ctx, body));
  });
}
