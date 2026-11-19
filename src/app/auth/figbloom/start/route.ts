import { NextResponse } from "next/server";
import { ATTEMPT_COOKIE, attemptCookieOptions, encodeAttempt } from "@/auth/figbloom/attemptCookie";
import { newSignInAttempt } from "@/auth/figbloom/oidc";
import { authorizeUrl, figbloomSettings, figbloomSignInEnabled, safeNext } from "@/auth/figbloom/settings";

export const dynamic = "force-dynamic";

/**
 * Starts a Figbloom sign-in (ERP/CRM_COGNITO_CONTRACT.md section 2): a fresh state and PKCE verifier, kept in a
 * short-lived cookie for the callback, and the browser sent to Figbloom's sign-in page. `next` (a path in CRM) is
 * where the person lands afterwards. With the switch off this route doesn't exist.
 */
export async function GET(request: Request) {
  if (!figbloomSignInEnabled()) return new NextResponse("Not found", { status: 404 });
  const settings = figbloomSettings();
  const { state, codeVerifier, codeChallenge } = newSignInAttempt();
  const next = safeNext(new URL(request.url).searchParams.get("next"));

  const response = NextResponse.redirect(authorizeUrl(settings, state, codeChallenge));
  response.cookies.set(ATTEMPT_COOKIE, encodeAttempt({ state, codeVerifier, next }), attemptCookieOptions);
  return response;
}
