import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { withIdempotency } from "@/lib/idempotency";
import { quickLog } from "@/services/quickLogService";

const QuickLogSchema = z.strictObject({
  channel: z.enum(["CALL", "WHATSAPP"], { error: "channel must be CALL or WHATSAPP." }),
  outcome: z.enum(["REACHED", "NO_ANSWER", "LEFT_MESSAGE"], { error: "outcome must be REACHED, NO_ANSWER or LEFT_MESSAGE." }),
  note: z.string().optional(),
  durationSeconds: z.number().optional(),
  /** A number used when there is none on file. */
  phoneUsed: z.string().optional(),
  followUp: z.strictObject({ title: z.string(), dueOn: z.string().optional() }).optional(),
  // Exactly one of these says who it was about.
  contactId: z.string().optional(),
  leadId: z.string().optional(),
  companyId: z.string().optional(),
  dealId: z.string().optional(),
});

// One-tap log after a call or WhatsApp message (FIG-1054). Send an Idempotency-Key: a double tap on mobile logs once.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, QuickLogSchema);
    return withIdempotency(ctx, request, body, () => quickLog(ctx, body));
  });
}
