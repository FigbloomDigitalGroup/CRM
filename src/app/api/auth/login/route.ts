import { NextResponse } from "next/server";
import { UnauthorizedError, ValidationError } from "@/auth/errors";
import { SESSION_COOKIE_NAME } from "@/auth/session";
import { logger } from "@/lib/logger";
import { login } from "@/services/authService";

/**
 * Real sign-in (FIG-592). Body: { "email": "...", "password": "..." }.
 * Every failure (unknown email, inactive user, no password set yet, wrong
 * password) returns the same generic 401 -- see authService.ts's header
 * comment for why this endpoint is held to the stricter, enumeration-
 * resistant standard used elsewhere only for public internet-facing surfaces.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
  };

  if (!body.email || !body.password) {
    return NextResponse.json(
      { error: "Email and password are required." },
      { status: 400 },
    );
  }

  try {
    const { token, expiresAt, userId } = await login(
      body.email,
      body.password,
      request.headers.get("user-agent"),
    );

    const response = NextResponse.json({ userId });
    response.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
    });
    return response;
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    logger.error({ err }, "Unhandled error during login");
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 },
    );
  }
}
