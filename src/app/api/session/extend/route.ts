import { NextResponse } from "next/server";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { setSessionCookie } from "@/app/api/_lib/sessionCookie";
import { NotFoundError } from "@/auth/errors";
import { resolveUserContext } from "@/auth/requestContext";
import { extendMySession } from "@/services/sessionService";

/** "Stay signed in" (B1.04): one more policy period from now, never past the session's absolute ceiling. */
export async function POST() {
  return handleRoute(async () => {
    const { userId, session, sessionToken } = await resolveUserContext();
    if (!session || !sessionToken) throw new NotFoundError("Session", "current");
    const result = await extendMySession(userId, session.id);
    const response = NextResponse.json(result);
    // The cookie's own expiry has to move with the session.
    setSessionCookie(response, sessionToken, new Date(result.session.expiresAt));
    return response;
  });
}
