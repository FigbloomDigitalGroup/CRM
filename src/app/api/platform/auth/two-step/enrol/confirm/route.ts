import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getClientInfo } from "@/app/api/_lib/clientRequest";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, requiredString } from "@/app/api/_lib/validation";
import { clearPlatformPendingCookie, PLATFORM_PENDING_COOKIE_NAME, setPlatformSessionCookie } from "@/app/api/platform/_lib/platformCookies";
import { confirmPlatformEnrolment } from "@/services/platformSignInService";

const Schema = z.object({ code: requiredString("Enter the 6-digit code.") });

/** Finishes platform two-step set-up: the first code turns it on, returns the backup codes once, and creates the session. */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const body = await parseJsonBody(request, Schema);
    const token = (await cookies()).get(PLATFORM_PENDING_COOKIE_NAME)?.value;
    const done = await confirmPlatformEnrolment(token, body.code, getClientInfo(request));
    const response = NextResponse.json({ landing: "/platform", backupCodes: done.backupCodes });
    setPlatformSessionCookie(response, done.token, done.absoluteExpiresAt);
    clearPlatformPendingCookie(response);
    return response;
  });
}
