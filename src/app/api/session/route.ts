import { handleRoute } from "@/app/api/_lib/handleRoute";
import { NotFoundError } from "@/auth/errors";
import { resolveUserContext } from "@/auth/requestContext";
import { getSessionSummary } from "@/services/sessionService";

/** The current session's time left and when to warn (B1.04) -- what the top bar polls. */
export async function GET() {
  return handleRoute(async () => {
    const { userId, session } = await resolveUserContext();
    if (!session) throw new NotFoundError("Session", "current");
    return getSessionSummary(userId, session.id);
  });
}
