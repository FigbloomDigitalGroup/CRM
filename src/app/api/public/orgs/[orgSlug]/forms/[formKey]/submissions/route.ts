import { getClientIp, getRequestOrigin } from "@/app/api/_lib/clientRequest";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { submitWebForm } from "@/services/webFormSubmissionService";

/**
 * Receives a web form submission (FIG-1151): public, session-less, in the same `/api/public` namespace as the website lead endpoint
 * so it never shares authorisation code with `/api/orgs/**`. The form's public key is in the address (it is embedded in a web page,
 * so it is not a secret); every protection is in `submitWebForm`: size cap, rate limits, allowed websites, the form's own field
 * rules, the hidden trap, optional captcha and a link-spam check. Browsers on the form's own website call it cross-origin, so
 * CORS is open here and the allowed-websites rule is enforced from the Origin header on the server.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; formKey: string }> },
) {
  const res = await handleRoute(async () => {
    const { orgSlug, formKey } = await params;
    const rawBodyText = await request.text();
    const result = await submitWebForm(orgSlug, formKey, rawBodyText, { ipAddress: getClientIp(request), origin: getRequestOrigin(request) });
    return { status: "received", message: result.message };
  });
  res.headers.set("Access-Control-Allow-Origin", "*");
  return res;
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "content-type", "Access-Control-Max-Age": "600" },
  });
}
