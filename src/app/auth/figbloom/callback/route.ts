import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getClientInfo } from "@/app/api/_lib/clientRequest";
import { setSessionCookie } from "@/app/api/_lib/sessionCookie";
import { ATTEMPT_COOKIE, decodeAttempt } from "@/auth/figbloom/attemptCookie";
import { exchangeCode, FigbloomSignInError, verifyIdToken } from "@/auth/figbloom/oidc";
import { ERROR_PATH, figbloomSettings, figbloomSignInEnabled } from "@/auth/figbloom/settings";
import { signInWithFigbloom } from "@/services/figbloomSignInService";

export const dynamic = "force-dynamic";

/**
 * Where Figbloom's sign-in page sends the browser back (ERP/CRM_COGNITO_CONTRACT.md section 2): checks the state,
 * exchanges the code with CRM's client secret, verifies the ID token, then issues CRM's own session cookie and goes
 * to `next`, the person's first organisation, or "awaiting access". Every refusal goes to the error page, never to
 * /login (which would loop straight back to the sign-in page).
 */
export async function GET(request: Request) {
  if (!figbloomSignInEnabled()) return new NextResponse("Not found", { status: 404 });
  const settings = figbloomSettings();
  const url = new URL(request.url);
  const fail = (code: string) => {
    const response = NextResponse.redirect(new URL(`${ERROR_PATH}?code=${encodeURIComponent(code)}`, settings.appBaseUrl));
    response.cookies.delete(ATTEMPT_COOKIE);
    return response;
  };

  // the person cancelled, or Cognito refused (e.g. an expired page): start again from the error page
  if (url.searchParams.get("error")) return fail("sign_in_failed");

  const attempt = decodeAttempt((await cookies()).get(ATTEMPT_COOKIE)?.value);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  // no attempt: a "Forgot password" finished on the sign-in page, or the cookie expired; just sign in again
  if (!attempt) return NextResponse.redirect(new URL("/login", settings.appBaseUrl));
  if (!code || !state || state !== attempt.state) return fail("state_mismatch");

  try {
    const idToken = await exchangeCode(settings, code, attempt.codeVerifier);
    const identity = await verifyIdToken(settings, idToken);
    const session = await signInWithFigbloom(identity, getClientInfo(request));
    const destination = attempt.next ?? (session.organizationSlug ? `/o/${session.organizationSlug}` : "/");
    const response = NextResponse.redirect(new URL(destination, settings.appBaseUrl));
    setSessionCookie(response, session.token, session.expiresAt);
    response.cookies.delete(ATTEMPT_COOKIE);
    return response;
  } catch (err) {
    if (err instanceof FigbloomSignInError) return fail(err.code);
    console.error("[figbloom-sign-in] callback failed:", err instanceof Error ? err.message : err);
    return fail("sign_in_failed");
  }
}
