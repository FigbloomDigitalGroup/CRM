import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveGatedContext } from "@/app/api/_lib/gatedContext";
import { getTwoStepPolicy, setTwoStepPolicy } from "@/services/twoStepService";

const Schema = z.object({ required: z.boolean({ error: "required must be true or false." }) });

/** Whether the organisation requires two-step sign-in (FIG-1134; needs `security.manage`). */
export async function GET(_request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => getTwoStepPolicy(await resolveGatedContext((await params).orgSlug, "release.v11")));
}

/** Management requires it (or stops requiring it). Turning it on needs the actor's own two-step and signs out members who have none. */
export async function PATCH(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const ctx = await resolveGatedContext((await params).orgSlug, "release.v11");
    const body = await parseJsonBody(request, Schema);
    return setTwoStepPolicy(ctx, body.required);
  });
}
