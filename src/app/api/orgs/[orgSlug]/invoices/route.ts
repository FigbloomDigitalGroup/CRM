import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { pageQueryShape, toPageRequest } from "@/app/api/_lib/pageQuery";
import { parseJsonBody, parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { withIdempotency } from "@/lib/idempotency";
import { createInvoice, listInvoices } from "@/services/paymentService";

const ListInvoicesQuerySchema = z.object({
  /** DRAFT, SENT, PART_PAID, PAID, OVERDUE or VOID. */
  status: z.string().optional(),
  overdue: z.enum(["true", "false"]).optional(),
  companyId: z.string().optional(),
  dealId: z.string().optional(),
  dueFrom: z.string().optional(),
  dueTo: z.string().optional(),
  // UC-R7 (additive): amount range and "still owed" only.
  amountMin: z.string().optional(),
  amountMax: z.string().optional(),
  hasBalance: z.enum(["true", "false"]).optional(),
  q: z.string().optional(),
  ...pageQueryShape,
});

const CreateInvoiceSchema = z.strictObject({
  number: z.string({ error: "number is required." }),
  amount: z.union([z.number(), z.string()], { error: "amount is required." }),
  currency: z.string().optional(),
  issuedOn: z.string({ error: "issuedOn is required." }),
  dueOn: z.string({ error: "dueOn is required." }),
  companyId: z.string().optional(),
  dealId: z.string().optional(),
  recurringServiceId: z.string().optional(),
  notes: z.string().optional(),
  sent: z.boolean().optional(),
});

// The Payments tracker list (FIG-1050, B3.04): Finance and Management only, with totals by status.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, ListInvoicesQuerySchema);
    return listInvoices(
      ctx,
      { status: query.status, overdue: query.overdue === "true", companyId: query.companyId, dealId: query.dealId, dueFrom: query.dueFrom, dueTo: query.dueTo, amountMin: query.amountMin, amountMax: query.amountMax, hasBalance: query.hasBalance === "true", q: query.q },
      { ...toPageRequest(query), sort: query.sort },
    );
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, CreateInvoiceSchema);
    return withIdempotency(ctx, request, body, () => createInvoice(ctx, body));
  });
}
