import type { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/auth/session";

/** The one place the session cookie's attributes are decided (httpOnly, lax, expires with the session). */
export function setSessionCookie(response: NextResponse, token: string, expiresAt: Date): void {
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}
