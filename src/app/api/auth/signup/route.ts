import { NextResponse } from "next/server";
import { ValidationError } from "@/auth/errors";
import { SESSION_COOKIE_NAME } from "@/auth/session";
import { logger } from "@/lib/logger";
import { signup } from "@/services/authService";

/**
 * Creates an account and signs the caller straight in -- see
 * authService.ts#signup for why this grants no organization access on its
 * own. Body: { "email": "...", "password": "...", "name": "..." }.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    name?: string;
  };

  if (!body.email || !body.password || !body.name) {
    return NextResponse.json(
      { error: "Name, email and password are required." },
      { status: 400 },
    );
  }

  try {
    const { token, expiresAt, userId } = await signup(
      body.email,
      body.password,
      body.name,
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
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    logger.error({ err }, "Unhandled error during signup");
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 },
    );
  }
}
