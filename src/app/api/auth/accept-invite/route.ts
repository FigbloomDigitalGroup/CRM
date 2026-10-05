import { NextResponse } from "next/server";
import { ValidationError } from "@/auth/errors";
import { SESSION_COOKIE_NAME } from "@/auth/session";
import { logger } from "@/lib/logger";
import { acceptMembershipInvite } from "@/services/authService";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    token?: string;
    password?: string;
  };
  if (!body.token) {
    return NextResponse.json({ error: "token is required." }, { status: 400 });
  }

  try {
    const { token, expiresAt, userId, organizationSlug } = await acceptMembershipInvite(
      body.token,
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
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    logger.error({ err }, "Unhandled error accepting membership invite");
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 },
    );
  }
}
