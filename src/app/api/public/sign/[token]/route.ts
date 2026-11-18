import { NextResponse } from "next/server";
import { getClientIp } from "@/app/api/_lib/clientRequest";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { limitQuoteSign } from "@/auth/publicLimits";
import { NotFoundError } from "@/auth/errors";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { z } from "zod";
import { newRequestId } from "@/lib/apiErrors";
import { getSigningPage, signQuote } from "@/services/quoteSignatureService";

const NO_STORE = { "cache-control": "private, no-store", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer" };

const SignSchema = z.strictObject({
  signerName: z.string(),
  signerEmail: z.string().optional(),
  consent: z.boolean(),
  signature: z.strictObject({ kind: z.enum(["TYPED", "DRAWN"]), data: z.string().optional() }).optional(),
  language: z.string().optional(),
});

/** The standard error envelope (`src/lib/apiErrors.ts`) for the answers that have no typed error; their codes are specific to this route. */
function refusal(status: number, code: string, message: string) {
  const requestId = newRequestId(null);
  return NextResponse.json({ error: message, code, message, fieldErrors: [], requestId }, { status, headers: { ...NO_STORE, "x-request-id": requestId } });
}

function gone(organisationName: string) {
  return refusal(410, "LINK_EXPIRED", `This link has expired. Ask ${organisationName} to send you a new link.`);
}

// The signing page's data for one link (FIG-1186, B7.04). No sign-in: the token is the secret, as for the quote link. An unknown, revoked,
// replaced or not-signable link answers 404 (V1 and V1.1 organisations answer the same), an expired one 410.
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  return handleRoute(async () => {
    const { token } = await params;
    await limitQuoteSign(getClientIp(request));
    const result = await getSigningPage(token);
    if (result.status === "not_found") throw new NotFoundError("SigningLink", "link");
    if (result.status === "expired") return gone(result.organisationName);
    return NextResponse.json(result, { headers: NO_STORE });
  });
}

// Signs the quote: one signature, once. 400 for an incomplete signature, 404 unknown link, 409 already answered, 410 expired.
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  return handleRoute(async () => {
    const { token } = await params;
    const ip = getClientIp(request);
    await limitQuoteSign(ip);
    const body = await parseJsonBody(request, SignSchema);
    const result = await signQuote(token, body, { ipAddress: ip, userAgent: request.headers.get("user-agent") });
    if (result.status === "not_found") throw new NotFoundError("SigningLink", "link");
    if (result.status === "expired") return gone(result.organisationName);
    if (result.status === "already_signed") return refusal(409, "ALREADY_ANSWERED", "This quote has already been answered.");
    if (result.status === "integrity_error") return refusal(409, "DOCUMENT_INTEGRITY", "The document could not be checked, so it was not signed. Contact the sender.");
    return NextResponse.json(result, { status: 201, headers: NO_STORE });
  });
}
