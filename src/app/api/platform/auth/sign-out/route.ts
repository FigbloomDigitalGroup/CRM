import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { PLATFORM_SESSION_COOKIE_NAME, lookupPlatformSession } from "@/auth/platformSession";
import { platformSignOut } from "@/services/platformSignInService";

/** Ends the platform session (revoked server side, cookie removed). Always succeeds, signed in or not. */
export async function POST() {
  return handleRoute(async () => {
    const token = (await cookies()).get(PLATFORM_SESSION_COOKIE_NAME)?.value;
    if (token) {
      const found = await lookupPlatformSession(token);
      await platformSignOut(token, found.state === "active" ? found.identity : null);
    }
    const response = NextResponse.json({ ok: true });
    response.cookies.delete(PLATFORM_SESSION_COOKIE_NAME);
    return response;
  });
}
