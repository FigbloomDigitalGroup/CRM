import { handleRoute } from "@/app/api/_lib/handleRoute";
import { NotFoundError } from "@/auth/errors";
import { resolveUserContext } from "@/auth/requestContext";
import { signOutOtherSessions } from "@/services/sessionService";

/** Signs out every device except this one (B1.04). */
export async function POST() {
  return handleRoute(async () => {
    const { userId, session } = await resolveUserContext();
    if (!session) throw new NotFoundError("Session", "current");
    return signOutOtherSessions(userId, session.id);
  });
}
