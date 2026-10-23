import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveUserContext } from "@/auth/requestContext";
import { listMySessions } from "@/services/sessionService";

/** Every device the person is signed in on, current one first (B1.04). */
export async function GET() {
  return handleRoute(async () => {
    const { userId, session } = await resolveUserContext();
    return { items: await listMySessions(userId, session?.id ?? null) };
  });
}
