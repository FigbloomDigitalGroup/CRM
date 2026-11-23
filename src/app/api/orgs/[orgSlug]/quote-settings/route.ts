import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { loadInvoiceNumbering, salesDraftInvoicesEnabled, updateInvoiceNumbering, updateSalesDraftInvoices } from "@/services/invoiceSettingsService";
import { getQuoteSettings, loadQuoteSettings, updateQuoteSettings } from "@/services/quoteService";

const SettingsSchema = z.strictObject({
  /** When on, a deal cannot move to Proposal Sent without a valid quote; the block says why. */
  requireForProposalSent: z.boolean().optional(),
  validityDays: z.number().int().optional(),
  defaultTerms: z.string().optional(),
  /** UC-R5: the tax setting NEW quotes copy. An object sets it (mode INCLUSIVE or EXCLUSIVE, rateBp in basis points, label); null switches tax off. Quotes already made never change. */
  tax: z.strictObject({ mode: z.string(), rateBp: z.number(), label: z.string().optional() }).nullable().optional(),
  /** UC-R8: invoice auto-numbering. `auto` switches it on; `prefix` is 1 to 20 characters (letters, digits and - _ . /). Management only. */
  invoiceNumbering: z.strictObject({ auto: z.boolean().optional(), prefix: z.string().optional() }).optional(),
  /** UC-R10: lets Sales create and read DRAFT invoices of their own won deals. Off by default. Management only. */
  salesDraftInvoices: z.boolean().optional(),
});

/** The quote settings, plus the invoice numbering setting when the organisation has set it (additive; absent otherwise). */
async function withInvoiceNumbering<T extends object>(organizationId: string, quote: T) {
  const invoiceNumbering = await loadInvoiceNumbering(organizationId);
  const salesDraftInvoices = await salesDraftInvoicesEnabled(organizationId);
  return { ...quote, ...(invoiceNumbering ? { invoiceNumbering } : {}), salesDraftInvoices };
}

// Quote defaults and the Proposal Sent gate (FIG-1143, B6.11; Management writes).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return withInvoiceNumbering(ctx.organizationId, await getQuoteSettings(ctx));
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const { invoiceNumbering, salesDraftInvoices, ...quotePatch } = await parseJsonBody(request, SettingsSchema);
    // Quote fields first (they need the quotes feature); a body with only invoice numbering does not.
    const quote = Object.keys(quotePatch).length > 0 || (invoiceNumbering === undefined && salesDraftInvoices === undefined) ? await updateQuoteSettings(ctx, quotePatch) : await loadQuoteSettings(ctx.organizationId);
    if (invoiceNumbering !== undefined) await updateInvoiceNumbering(ctx, invoiceNumbering);
    if (salesDraftInvoices !== undefined) await updateSalesDraftInvoices(ctx, salesDraftInvoices);
    return withInvoiceNumbering(ctx.organizationId, quote);
  });
}
