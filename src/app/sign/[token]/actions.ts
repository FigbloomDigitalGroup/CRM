"use server";

import { headers } from "next/headers";
import { getClientIp } from "@/app/api/_lib/clientRequest";
import { limitQuoteSign } from "@/auth/publicLimits";
import { RateLimitedError, ValidationError } from "@/auth/errors";
import { signQuote } from "@/services/quoteSignatureService";

export type SignActionResult =
  | { ok: true; signedAt: string; signerName: string; reference: string }
  | { ok: false; code: "INVALID" | "EXPIRED" | "NOT_FOUND" | "ALREADY_ANSWERED" | "INTEGRITY" | "RATE_LIMITED"; fieldCodes?: string[] };

/**
 * The signing page's submit (FIG-1186). It runs the same service as `POST /api/public/sign/{token}`, with the same rate limit; the address and
 * device come from the request headers. A server action carries Next.js's own origin check, so no other site can submit it for a visitor.
 */
export async function signQuoteAction(token: string, input: { signerName: string; signerEmail?: string; consent: boolean; language: string }): Promise<SignActionResult> {
  const h = await headers();
  const ip = getClientIp(new Request("http://localhost/", { headers: h }));
  try {
    await limitQuoteSign(ip);
    const result = await signQuote(token, { ...input, signature: { kind: "TYPED" } }, { ipAddress: ip, userAgent: h.get("user-agent") });
    switch (result.status) {
      case "signed":
        return { ok: true, signedAt: result.signedAt.toISOString(), signerName: result.signerName, reference: result.reference };
      case "expired":
        return { ok: false, code: "EXPIRED" };
      case "already_signed":
        return { ok: false, code: "ALREADY_ANSWERED" };
      case "integrity_error":
        return { ok: false, code: "INTEGRITY" };
      default:
        return { ok: false, code: "NOT_FOUND" };
    }
  } catch (err) {
    if (err instanceof ValidationError) return { ok: false, code: "INVALID", fieldCodes: (err.issues ?? []).map((i) => i.code ?? i.path) };
    if (err instanceof RateLimitedError) return { ok: false, code: "RATE_LIMITED" };
    throw err;
  }
}
