import { figbloomSettings, figbloomSignInEnabled, forgotPasswordUrl, safeNext, START_PATH } from "./settings";

type Env = Record<string, string | undefined>;

/**
 * Where a frozen sign-in page sends the browser when Figbloom sign-in is on (ERP/CRM_COGNITO_CONTRACT.md section 2),
 * or null to show the page as it is. /signup and /accept-invite are never redirected: their forms stay and create the
 * Figbloom account themselves.
 */
export function figbloomPageRedirect(pathname: string, search: URLSearchParams, env: Env = process.env): string | null {
  if (!figbloomSignInEnabled(env)) return null;
  if (pathname === "/login") {
    const next = safeNext(search.get("next"));
    return next ? `${START_PATH}?next=${encodeURIComponent(next)}` : START_PATH;
  }
  if (pathname === "/forgot-password" || pathname === "/reset-password") {
    return forgotPasswordUrl(figbloomSettings(env));
  }
  return null;
}
