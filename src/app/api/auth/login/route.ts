import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getClientInfo } from "@/app/api/_lib/clientRequest";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, requiredString } from "@/app/api/_lib/validation";
import { setSessionCookie } from "@/app/api/_lib/sessionCookie";
import { setPendingTwoStepCookie } from "@/app/api/_lib/twoStepCookies";
import { startSignIn } from "@/services/authService";
import { TRUSTED_DEVICE_COOKIE_NAME } from "@/services/twoStepService";

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
 *
 * Two-step (FIG-1134): when the account needs a second step the answer has the
 * same shape, with `twoStepRequired: true`, but NO session cookie is set; a
 * short-lived pending-challenge cookie is set instead, and the app sends the
 * person to /two-step (the /o layout does it). The
 * frozen login page needs no change: it still just follows `organizationSlug`.
 */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const body = await parseJsonBody(request, LoginSchema);
    const client = getClientInfo(request);
    const trusted = (await cookies()).get(TRUSTED_DEVICE_COOKIE_NAME)?.value;
    const result = await startSignIn(body.email, body.password, client.userAgent, client.ipAddress, client.place, trusted);

    if ("twoStepRequired" in result) {
      const response = NextResponse.json({
        userId: result.userId,
        // The frozen page needs a landing target to follow; the /o layout turns it into the two-step page.(the /o layout).
        organizationSlug: result.organizationSlug ?? "account",
        awaitingAccess: result.access.awaitingAccess,
        access: result.access,
        twoStepRequired: true,
        twoStepPurpose: result.purpose,
        twoStepUrl: "/two-step",
      });
      setPendingTwoStepCookie(response, result.challengeToken, result.challengeExpiresAt);
      return response;
    }

    const { token, expiresAt, userId, organizationSlug, access } = result;
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
