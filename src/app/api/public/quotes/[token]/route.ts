import { NextResponse } from "next/server";
import { getClientIp } from "@/app/api/_lib/clientRequest";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { limitQuoteView } from "@/auth/publicLimits";
import { escapeHtml } from "@/lib/quoteDocument";
import { openQuoteLink } from "@/services/quoteDocumentService";

const HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "private, no-store",
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
};

function notice(title: string, text: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>body{font:16px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#f6f8f7;color:#1b2420}main{max-width:420px;padding:24px;text-align:center}</style></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p></main></body></html>`;
}

// The client opens a quote from the link in the email (FIG-1144, B6.12). No sign-in: the token is the secret. An unknown or revoked
// link answers 404, an expired one 410; both pages say only what the client needs. A view is logged and reaches the deal timeline.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  return handleRoute(async () => {
    const { token } = await params;
    await limitQuoteView(getClientIp(request));
    const result = await openQuoteLink(token, { userAgent: request.headers.get("user-agent") });
    if (result.status === "ok") return new NextResponse(result.html, { status: 200, headers: HEADERS });
    if (result.status === "expired") {
      return new NextResponse(notice("This link has expired", `Ask ${result.organizationName} to send you a new link.`), { status: 410, headers: HEADERS });
    }
    return new NextResponse(notice("This link is not valid", "Check the link in your email, or ask the sender for a new one."), { status: 404, headers: HEADERS });
  });
}
