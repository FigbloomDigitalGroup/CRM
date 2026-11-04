import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getClientInfo } from "@/app/api/_lib/clientRequest";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, requiredString } from "@/app/api/_lib/validation";
import { clearPlatformPendingCookie, PLATFORM_PENDING_COOKIE_NAME, setPlatformSessionCookie } from "@/app/api/platform/_lib/platformCookies";
import { verifyPlatformSignInCode } from "@/services/platformSignInService";

const Schema = z.object({ code: requiredString("Enter the code from your authenticator app, or a backup code.") });

/** Platform sign-in, second step: an authenticator code or a backup code. Creates the platform session. */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const body = await parseJsonBody(request, Schema);
    const token = (await cookies()).get(PLATFORM_PENDING_COOKIE_NAME)?.value;
    const done = await verifyPlatformSignInCode(token, body.code, getClientInfo(request));
    const response = NextResponse.json({ landing: "/platform", backupCodesRemaining: done.backupCodesRemaining });
    setPlatformSessionCookie(response, done.token, done.absoluteExpiresAt);
    clearPlatformPendingCookie(response);
    return response;
  });
}
