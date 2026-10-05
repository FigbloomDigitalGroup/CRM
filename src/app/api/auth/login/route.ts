import { NextResponse } from "next/server";
import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, requiredString } from "@/app/api/_lib/validation";
import { SESSION_COOKIE_NAME } from "@/auth/session";
import { login } from "@/services/authService";

const LoginSchema = z.object({
  email: requiredString("Email and password are required."),
  password: requiredString("Email and password are required."),
});

/**
 * Real sign-in (FIG-592). Body: { "email": "...", "password": "..." }.
 * Every failure (unknown email, inactive user, no password set yet, wrong
 * password) returns the same generic 401 -- see authService.ts's header
 * comment for why this endpoint is held to the stricter, enumeration-
 * resistant standard used elsewhere only for public internet-facing surfaces.
 */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const body = await parseJsonBody(request, LoginSchema);
    const { token, expiresAt, userId, organizationSlug } = await login(
      body.email,
      body.password,
      request.headers.get("user-agent"),
    );

    const response = NextResponse.json({ userId, organizationSlug });
    response.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
    });
    return response;
  });
}
