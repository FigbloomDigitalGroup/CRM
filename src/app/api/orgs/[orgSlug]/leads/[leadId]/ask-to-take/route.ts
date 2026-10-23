import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseOptionalJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { askToTake } from "@/services/leadPoolService";

const AskSchema = z.strictObject({ note: z.string().max(500).optional() });

// Asks to take an unassigned lead. In auto mode the first request wins at once; otherwise Management answers.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; leadId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, leadId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseOptionalJsonBody(request, AskSchema);
    return askToTake(ctx, leadId, body);
  });
}
