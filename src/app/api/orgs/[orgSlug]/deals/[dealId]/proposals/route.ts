import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, requiredString } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import {
  createProposalReference,
  listProposalReferences,
} from "@/services/proposalService";

const CreateProposalReferenceSchema = z.object({
  proposalNumber: requiredString("proposalNumber is required."),
  amount: z.union([z.number(), z.string()]).optional(),
  currency: z.string().optional(),
  documentReference: z.string().optional(),
  notes: z.string().optional(),
});

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
    const body = await parseJsonBody(request, CreateProposalReferenceSchema);
    return createProposalReference(ctx, dealId, body);
  });
}
