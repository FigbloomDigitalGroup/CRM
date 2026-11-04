import { handleRoute } from "@/app/api/_lib/handleRoute";
import { requirePlatformApi } from "@/app/api/platform/_lib/platformRoute";
import { checkDeletionGate, getDataRequest } from "@/services/platformDataRequestService";

/** One request: approvals, waiting period, export status and, for a deletion, what still stands in the way. FIG-1141. */
export async function GET(_request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  return handleRoute(async () => {
    await requirePlatformApi("platform.organizations.view");
    const { requestId } = await params;
    const request = await getDataRequest(requestId);
    const gate = request.kind === "DELETE" ? await checkDeletionGate(requestId) : null;
    return { ...request, deletionGate: gate ? { ok: gate.ok, blockers: gate.blockers } : null };
  });
}
