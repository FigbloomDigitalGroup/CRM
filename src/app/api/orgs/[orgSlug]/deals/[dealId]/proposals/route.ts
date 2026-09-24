import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import {
  createProposalReference,
  listProposalReferences,
} from "@/services/proposalService";

type RouteParams = { params: Promise<{ orgSlug: string; dealId: string }> };

export async function GET(request: Request, { params }: RouteParams) {
  return handleRoute(async () => {
    const { orgSlug, dealId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return listProposalReferences(ctx, dealId);
  });
}

export async function POST(request: Request, { params }: RouteParams) {
  return handleRoute(async () => {
    const { orgSlug, dealId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await request.json();
    return createProposalReference(ctx, dealId, body);
  });
}
