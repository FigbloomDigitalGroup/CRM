import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getClientInfo } from "@/app/api/_lib/clientRequest";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { setSessionCookie } from "@/app/api/_lib/sessionCookie";
import { clearPendingTwoStepCookie, PENDING_TWO_STEP_COOKIE_NAME, setTrustedDeviceCookie } from "@/app/api/_lib/twoStepCookies";
import { parseJsonBody, requiredString } from "@/app/api/_lib/validation";
import { confirmSignInEnrolment } from "@/services/twoStepSignInService";

const Schema = z.object({ code: requiredString("Enter the 6-digit code."), rememberDevice: z.boolean().optional() });

/** Finishes policy-forced enrolment: the first code turns two-step on, returns the backup codes (shown once) and only then signs the person in. */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const body = await parseJsonBody(request, Schema);
    const token = (await cookies()).get(PENDING_TWO_STEP_COOKIE_NAME)?.value;
    const done = await confirmSignInEnrolment(token, body.code, { remember: body.rememberDevice, ipAddress: getClientInfo(request).ipAddress });
    const response = NextResponse.json({
      userId: done.userId,
      organizationSlug: done.organizationSlug,
      awaitingAccess: done.access.awaitingAccess,
      access: done.access,
      backupCodes: done.backupCodes,
    });
    setSessionCookie(response, done.token, done.expiresAt);
    clearPendingTwoStepCookie(response);
    if (done.trustedDevice) setTrustedDeviceCookie(response, done.trustedDevice.token, done.trustedDevice.expiresAt);
    return response;
  });
}
