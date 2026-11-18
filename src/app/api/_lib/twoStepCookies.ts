import type { NextResponse } from "next/server";
import { PENDING_TWO_STEP_COOKIE } from "@/auth/twoStep/pending";
import { TRUSTED_DEVICE_COOKIE_NAME } from "@/services/twoStepService";

/** The pending second step (FIG-1134): a random token for a password-verified sign-in. httpOnly, ten minutes, never a session. */
export const PENDING_TWO_STEP_COOKIE_NAME = PENDING_TWO_STEP_COOKIE;
const SECURE = () => process.env.NODE_ENV === "production";

export function setPendingTwoStepCookie(response: NextResponse, token: string, expiresAt: Date): void {
  response.cookies.set(PENDING_TWO_STEP_COOKIE_NAME, token, { httpOnly: true, secure: SECURE(), sameSite: "lax", path: "/", expires: expiresAt });
}

export function clearPendingTwoStepCookie(response: NextResponse): void {
  response.cookies.delete(PENDING_TWO_STEP_COOKIE_NAME);
}

export function setTrustedDeviceCookie(response: NextResponse, token: string, expiresAt: Date): void {
  response.cookies.set(TRUSTED_DEVICE_COOKIE_NAME, token, { httpOnly: true, secure: SECURE(), sameSite: "lax", path: "/", expires: expiresAt });
}
