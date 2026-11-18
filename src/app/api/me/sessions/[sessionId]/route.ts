import { NextResponse } from "next/server";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveUserContext } from "@/auth/requestContext";
import { SESSION_COOKIE_NAME } from "@/auth/session";
import { revokeMySession } from "@/services/sessionService";

/** Signs one device out (B1.04); that device is logged out on its next request. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  return handleRoute(async () => {
    const { sessionId } = await params;
    const { userId, session } = await resolveUserContext();
    const result = await revokeMySession(userId, sessionId, session?.id ?? null);
    const response = NextResponse.json(result);
    if (result.wasCurrent) response.cookies.delete(SESSION_COOKIE_NAME);
    return response;
  });
}
