import type { NextResponse } from "next/server";
import { PLATFORM_SESSION_COOKIE_NAME } from "@/auth/platformSession";
import { PENDING_PLATFORM_TWO_STEP_COOKIE } from "@/auth/twoStep/pending";

/** The platform admin's pending second step (FIG-1134): a random token for a password-verified sign-in. httpOnly, ten minutes, never a session. */
export const PLATFORM_PENDING_COOKIE_NAME = PENDING_PLATFORM_TWO_STEP_COOKIE;
const secure = () => process.env.NODE_ENV === "production";

export function setPlatformPendingCookie(response: NextResponse, token: string, expiresAt: Date): void {
  response.cookies.set(PLATFORM_PENDING_COOKIE_NAME, token, { httpOnly: true, secure: secure(), sameSite: "strict", path: "/", expires: expiresAt });
}

export function clearPlatformPendingCookie(response: NextResponse): void {
  response.cookies.delete(PLATFORM_PENDING_COOKIE_NAME);
}

/** Strict same-site and expiring with the session's absolute limit: a platform session is never kept longer than its table row. */
export function setPlatformSessionCookie(response: NextResponse, token: string, expiresAt: Date): void {
  response.cookies.set(PLATFORM_SESSION_COOKIE_NAME, token, { httpOnly: true, secure: secure(), sameSite: "strict", path: "/", expires: expiresAt });
}
