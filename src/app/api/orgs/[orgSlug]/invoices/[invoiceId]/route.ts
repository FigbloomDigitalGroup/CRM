import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { getInvoice, updateInvoice } from "@/services/paymentService";

const UpdateInvoiceSchema = z.strictObject({
  number: z.string().optional(),
  amount: z.union([z.number(), z.string()]).optional(),
  dueOn: z.string().optional(),
  issuedOn: z.string().optional(),
  notes: z.string().nullable().optional(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; invoiceId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, invoiceId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getInvoice(ctx, invoiceId);
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; invoiceId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, invoiceId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, UpdateInvoiceSchema);
    return updateInvoice(ctx, invoiceId, body);
  });
}
