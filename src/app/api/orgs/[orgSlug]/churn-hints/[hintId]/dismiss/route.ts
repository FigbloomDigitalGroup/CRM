import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveGatedContext } from "@/app/api/_lib/gatedContext";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { dismissChurnHint } from "@/services/churnHintService";

const DismissSchema = z.strictObject({ reason: z.string().max(300).optional() });

// Dismisses a hint. It comes back only when the customer's situation changes.
export async function POST(request: Request, { params }: { params: Promise<{ orgSlug: string; hintId: string }> }) {
  return handleRoute(async () => {
    const { orgSlug, hintId } = await params;
    const ctx = await resolveGatedContext(orgSlug, "release.v2");
    return dismissChurnHint(ctx, hintId, await parseJsonBody(request, DismissSchema));
  });
}
