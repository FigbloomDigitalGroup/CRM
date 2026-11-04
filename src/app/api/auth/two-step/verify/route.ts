import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getClientInfo } from "@/app/api/_lib/clientRequest";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { setSessionCookie } from "@/app/api/_lib/sessionCookie";
import { clearPendingTwoStepCookie, PENDING_TWO_STEP_COOKIE_NAME, setTrustedDeviceCookie } from "@/app/api/_lib/twoStepCookies";
import { parseJsonBody, requiredString } from "@/app/api/_lib/validation";
import { verifySignInCode } from "@/services/twoStepSignInService";

const Schema = z.object({
  code: requiredString("Enter the code from your authenticator app, or a backup code."),
  rememberDevice: z.boolean().optional(),
});

/** Second step of sign-in (FIG-1134): an authenticator code or a backup code. Needs the pending cookie the password step set. Rate limited; five wrong codes end the challenge. */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const body = await parseJsonBody(request, Schema);
    const token = (await cookies()).get(PENDING_TWO_STEP_COOKIE_NAME)?.value;
    const done = await verifySignInCode(token, body.code, { remember: body.rememberDevice, ipAddress: getClientInfo(request).ipAddress });
    const response = NextResponse.json({
      userId: done.userId,
      organizationSlug: done.organizationSlug,
      awaitingAccess: done.access.awaitingAccess,
      access: done.access,
      backupCodesRemaining: done.backupCodesRemaining,
    });
    setSessionCookie(response, done.token, done.expiresAt);
    clearPendingTwoStepCookie(response);
    if (done.trustedDevice) setTrustedDeviceCookie(response, done.trustedDevice.token, done.trustedDevice.expiresAt);
    return response;
  });
}
