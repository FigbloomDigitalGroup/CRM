import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveGatedContext } from "@/app/api/_lib/gatedContext";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { rateChurnHint } from "@/services/churnHintService";

const FeedbackSchema = z.strictObject({
  value: z.enum(["HELPFUL", "NOT_HELPFUL"], { error: "value must be HELPFUL or NOT_HELPFUL." }),
  note: z.string().max(500).optional(),
});

// Was the hint useful? Kept with the hint to tune the rules later.
export async function POST(request: Request, { params }: { params: Promise<{ orgSlug: string; hintId: string }> }) {
  return handleRoute(async () => {
    const { orgSlug, hintId } = await params;
    const ctx = await resolveGatedContext(orgSlug, "release.v2");
    return rateChurnHint(ctx, hintId, await parseJsonBody(request, FeedbackSchema));
  });
}
