import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveUserContext } from "@/auth/requestContext";
import { listMySignInEvents } from "@/services/signInEventService";

/** The person's own recent sign-ins (B1.04) -- nobody else's. */
export async function GET(request: Request) {
  return handleRoute(async () => {
    const { userId } = await resolveUserContext();
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? 50);
    return { items: await listMySignInEvents(userId, Number.isFinite(limit) ? limit : 50) };
  });
}
