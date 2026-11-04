import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { requireFeature } from "@/services/featureService";
import { withIdempotency } from "@/lib/idempotency";
import { createSequence, listSequences } from "@/services/followUpService";

const CreateSequenceSchema = z.strictObject({
  name: z.string({ error: "name is required." }),
  description: z.string().nullable().optional(),
  subjectType: z.string({ error: "subjectType is required." }),
  trigger: z.string().optional(),
  exitRules: z.unknown().optional(),
  steps: z.unknown(),
});

// Follow-up sequences (FIG-1150, S6#2). Management (cadences.manage) sees all; people who can add tasks see the active ones.
export async function GET(_request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return listSequences(ctx);
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    await requireFeature(ctx.organizationId, "release.v11"); // release gate before body validation
    const body = await parseJsonBody(request, CreateSequenceSchema);
    return withIdempotency(ctx, request, body, () => createSequence(ctx, body));
  });
}
