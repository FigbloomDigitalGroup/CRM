import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, parseQueryParams } from "@/app/api/_lib/validation";
import { resolveGatedContext } from "@/app/api/_lib/gatedContext";
import { listMonthTargets, setTarget } from "@/services/forecastService";

const ListQuerySchema = z.object({ month: z.string().optional() });
const SetTargetSchema = z.strictObject({
  month: z.string({ error: "month is required (YYYY-MM)." }),
  /** null is the team target. */
  membershipId: z.string().nullable(),
  /** null removes the target. */
  amount: z.union([z.number(), z.string()]).nullable(),
});

// Targets for a month: everyone reads their own; forecast.view.all and targets.manage read all.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveGatedContext(orgSlug, "release.v11");
    const query = parseQueryParams(new URL(request.url).searchParams, ListQuerySchema);
    return listMonthTargets(ctx, query.month);
  });
}

// Sets (or, with amount null, removes) one person's or the team's target for a month. Needs targets.manage.
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveGatedContext(orgSlug, "release.v11");
    const body = await parseJsonBody(request, SetTargetSchema);
    return setTarget(ctx, body);
  });
}
