import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { deleteSequence, getSequence, updateSequence } from "@/services/followUpService";

const UpdateSequenceSchema = z.strictObject({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  trigger: z.string().optional(),
  isActive: z.boolean().optional(),
  exitRules: z.unknown().optional(),
  steps: z.unknown().optional(),
});

type Params = { params: Promise<{ orgSlug: string; sequenceId: string }> };

export async function GET(_request: Request, { params }: Params) {
  return handleRoute(async () => {
    const { orgSlug, sequenceId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getSequence(ctx, sequenceId);
  });
}

export async function PATCH(request: Request, { params }: Params) {
  return handleRoute(async () => {
    const { orgSlug, sequenceId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, UpdateSequenceSchema);
    return updateSequence(ctx, sequenceId, body);
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return handleRoute(async () => {
    const { orgSlug, sequenceId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return deleteSequence(ctx, sequenceId);
  });
}
