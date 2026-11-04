import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { requestConnectionSync } from "@/services/mailService";

// "Sync now": queues a sync of this mailbox or calendar on the job framework (FIG-807, FIG-808).
export async function POST(_request: Request, { params }: { params: Promise<{ orgSlug: string; connectionId: string }> }) {
  return handleRoute(async () => {
    const { orgSlug, connectionId } = await params;
    return requestConnectionSync(await resolveRequestContext(orgSlug), connectionId);
  });
}
