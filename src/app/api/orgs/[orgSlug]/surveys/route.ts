import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { pageQueryShape, toPageRequest } from "@/app/api/_lib/pageQuery";
import { parseJsonBody, parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { withIdempotency } from "@/lib/idempotency";
import { listSurveys, sendSurvey } from "@/services/ticketService";

const ListQuerySchema = z.object({ companyId: z.string().optional(), ...pageQueryShape });
const SendSchema = z.strictObject({
  ticketId: z.string().nullable().optional(),
  companyId: z.string().optional(),
  contactId: z.string().nullable().optional(),
});

/** Satisfaction survey results with the average score (needs `tickets.manage`). Answers only; never the link. */
export async function GET(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const ctx = await resolveRequestContext((await params).orgSlug);
    const q = parseQueryParams(new URL(request.url).searchParams, ListQuerySchema);
    return listSurveys(ctx, { companyId: q.companyId }, toPageRequest(q));
  });
}

/** Email a survey to a resolved ticket's contact (or a customer's first contact with an email). */
export async function POST(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const ctx = await resolveRequestContext((await params).orgSlug);
    const body = await parseJsonBody(request, SendSchema);
    return withIdempotency(ctx, request, body, () => sendSurvey(ctx, body));
  });
}
