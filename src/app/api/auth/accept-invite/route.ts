import { NextResponse } from "next/server";
import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, requiredString } from "@/app/api/_lib/validation";
import { SESSION_COOKIE_NAME } from "@/auth/session";
import { acceptMembershipInvite } from "@/services/authService";

const AcceptInviteSchema = z.object({
  token: requiredString("token is required."),
  // Only required when the invitee has no password yet -- a business rule
  // checked in authService.ts, not a shape rule enforceable here.
  password: z.string().optional(),
});

export async function POST(request: Request) {
  return handleRoute(async () => {
    const body = await parseJsonBody(request, AcceptInviteSchema);
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
  });
}
