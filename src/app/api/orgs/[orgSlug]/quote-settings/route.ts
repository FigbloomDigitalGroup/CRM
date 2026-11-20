import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { getQuoteSettings, updateQuoteSettings } from "@/services/quoteService";

const SettingsSchema = z.strictObject({
  /** When on, a deal cannot move to Proposal Sent without a valid quote; the block says why. */
  requireForProposalSent: z.boolean().optional(),
  validityDays: z.number().int().optional(),
  defaultTerms: z.string().optional(),
  /** UC-R5: the tax setting NEW quotes copy. An object sets it (mode INCLUSIVE or EXCLUSIVE, rateBp in basis points, label); null switches tax off. Quotes already made never change. */
  tax: z.strictObject({ mode: z.string(), rateBp: z.number(), label: z.string().optional() }).nullable().optional(),
});

// Quote defaults and the Proposal Sent gate (FIG-1143, B6.11; Management writes).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getQuoteSettings(ctx);
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return updateQuoteSettings(ctx, await parseJsonBody(request, SettingsSchema));
  });
}
