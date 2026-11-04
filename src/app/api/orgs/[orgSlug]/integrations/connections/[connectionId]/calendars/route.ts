import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { listProviderCalendars } from "@/services/meetingService";

// The calendars the provider lists for this connection, so the person can choose which one is used (FIG-808).
export async function GET(_request: Request, { params }: { params: Promise<{ orgSlug: string; connectionId: string }> }) {
  return handleRoute(async () => {
    const { orgSlug, connectionId } = await params;
    return listProviderCalendars(await resolveRequestContext(orgSlug), connectionId);
  });
}
