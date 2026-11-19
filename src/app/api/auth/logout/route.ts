import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/auth/session";
import { logout } from "@/services/authService";
import { figbloomSettings, figbloomSignInEnabled, signOutUrl } from "@/auth/figbloom/settings";

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    await logout(token);
  }

  // Figbloom sign-in: the browser also ends the sign-in page's own session, or /login would sign it straight back in
  const response = NextResponse.json(
    figbloomSignInEnabled() ? { ok: true, logoutUrl: signOutUrl(figbloomSettings()) } : { ok: true },
  );
  response.cookies.delete(SESSION_COOKIE_NAME);
  return response;
}
