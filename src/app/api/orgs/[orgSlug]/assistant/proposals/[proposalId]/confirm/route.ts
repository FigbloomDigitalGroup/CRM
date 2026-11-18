import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveGatedContext } from "@/app/api/_lib/gatedContext";
import { confirmProposal } from "@/services/assistantService";

// The person's explicit yes: only now does the suggested task get created, as them, under their own permissions.
export async function POST(_request: Request, { params }: { params: Promise<{ orgSlug: string; proposalId: string }> }) {
  return handleRoute(async () => {
    const { orgSlug, proposalId } = await params;
    return confirmProposal(await resolveGatedContext(orgSlug, "release.v11"), proposalId);
  });
}
