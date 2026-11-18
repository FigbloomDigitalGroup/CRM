import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { applySyncBatch } from "@/services/syncService";

const MutationSchema = z.looseObject({
  clientId: z.string({ error: "clientId is required." }),
  kind: z.string({ error: "kind is required." }),
  payload: z.record(z.string(), z.unknown()).optional(),
  clientCreatedAt: z.string().optional(),
});
const BatchSchema = z.strictObject({ mutations: z.array(MutationSchema, { error: "mutations must be a list." }) });

// The offline queue (FIG-1064, B4.07): up to 100 queued actions, each with a client id. Every item is answered APPLIED,
// DUPLICATE, CONFLICT or REJECTED; sending the same batch twice changes nothing. No Idempotency-Key header: the client ids are the keys.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, BatchSchema);
    return applySyncBatch(ctx, body);
  });
}
