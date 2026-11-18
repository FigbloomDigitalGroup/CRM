import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { dismissProposal } from "@/services/assistantService";

export async function POST(_request: Request, { params }: { params: Promise<{ orgSlug: string; proposalId: string }> }) {
  return handleRoute(async () => {
    const { orgSlug, proposalId } = await params;
    return dismissProposal(await resolveRequestContext(orgSlug), proposalId);
  });
}
