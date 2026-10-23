import { NextResponse } from "next/server";
import { z } from "zod";
import { getClientInfo } from "@/app/api/_lib/clientRequest";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, requiredString } from "@/app/api/_lib/validation";
import { setSessionCookie } from "@/app/api/_lib/sessionCookie";
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
    const client = getClientInfo(request);
    const { token, expiresAt, userId, organizationSlug, access } = await login(
      body.email,
      body.password,
      client.userAgent,
      client.ipAddress,
      client.place,
    );

    // `awaitingAccess` (B1.12) lets the UI send an account with no
    // organisation to the awaiting-access screen instead of an empty app.
    const response = NextResponse.json({
      userId,
      organizationSlug,
      awaitingAccess: access.awaitingAccess,
      access,
    });
    setSessionCookie(response, token, expiresAt);
    return response;
  });
}
