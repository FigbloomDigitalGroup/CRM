import { NextResponse } from "next/server";
import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, requiredString } from "@/app/api/_lib/validation";
import { SESSION_COOKIE_NAME } from "@/auth/session";
import { signup } from "@/services/authService";

const SignupSchema = z.object({
  email: requiredString("Name, email and password are required."),
  password: requiredString("Name, email and password are required."),
  name: requiredString("Name, email and password are required."),
});

/**
 * Creates an account and signs the caller straight in -- see
 * authService.ts#signup for why this grants no organization access on its
 * own. Body: { "email": "...", "password": "...", "name": "..." }.
 */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const body = await parseJsonBody(request, SignupSchema);
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
  });
}
