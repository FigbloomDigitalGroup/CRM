import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveGatedContext } from "@/app/api/_lib/gatedContext";
import { enforceRateLimit } from "@/auth/rateLimiter";
import { askAssistant } from "@/services/assistantService";

const AskSchema = z.strictObject({
  question: z.string().min(1).max(1000),
  record: z.strictObject({ kind: z.enum(["lead", "deal", "company"]), id: z.string() }).nullable().optional(),
});

// Ask Figbloom (FIG-1152): answers from what the person's role can see; may propose a task but never acts. 403 when switched off.
export async function POST(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveGatedContext(orgSlug, "release.v11");
    await enforceRateLimit("ASSISTANT_ASK", [{ scope: "member", key: ctx.membershipId, windowMs: 60_000, max: 10 }]);
    return askAssistant(ctx, orgSlug, await parseJsonBody(request, AskSchema));
  });
}
