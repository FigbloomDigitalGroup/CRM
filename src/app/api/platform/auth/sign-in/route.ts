import { NextResponse } from "next/server";
import { z } from "zod";
import { getClientInfo } from "@/app/api/_lib/clientRequest";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, requiredString } from "@/app/api/_lib/validation";
import { setPlatformPendingCookie } from "@/app/api/platform/_lib/platformCookies";
import { startPlatformSignIn } from "@/services/platformSignInService";

const Schema = z.object({
  email: requiredString("Email and password are required."),
  password: requiredString("Email and password are required."),
});

/**
 * Platform admin sign-in, password step (FIG-1134/FIG-1140). Never returns a session: it sets a ten-minute pending
 * cookie and says which second step comes next (`VERIFY` a code, or `ENROL` set up two-step first). Every failure
 * gives the same generic 401; rate limited per address and per email; repeated failures lock the identity.
 */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const body = await parseJsonBody(request, Schema);
    const result = await startPlatformSignIn(body.email, body.password, getClientInfo(request));
    const response = NextResponse.json({ twoStepRequired: true, purpose: result.purpose });
    setPlatformPendingCookie(response, result.challengeToken, result.challengeExpiresAt);
    return response;
  });
}
