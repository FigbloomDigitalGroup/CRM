import { getClientIp, getRequestOrigin } from "@/app/api/_lib/clientRequest";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { getPublicForm } from "@/services/webFormSubmissionService";

/**
 * The public definition of a published web form (FIG-1151): the fields to draw, the hidden trap field's name and whether a captcha is
 * needed. Session-less; the form's public key and the organisation slug together are the address. Read only, rate limited, and the
 * same generic 404 answers for an unknown key, a wrong organisation or a form that is not published.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; formKey: string }> },
) {
  const res = await handleRoute(async () => {
    const { orgSlug, formKey } = await params;
    return getPublicForm(orgSlug, formKey, { ipAddress: getClientIp(request), origin: getRequestOrigin(request) });
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
