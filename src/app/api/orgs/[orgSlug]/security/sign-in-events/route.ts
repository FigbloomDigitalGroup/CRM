import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { pageQueryShape, toPageRequest } from "@/app/api/_lib/pageQuery";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { listSignInEvents } from "@/services/signInEventService";

const QuerySchema = z.object({
  membershipId: z.string().optional(),
  outcome: z.enum(["SUCCESS", "FAILURE", "LOCKOUT", "NEW_DEVICE"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  ...pageQueryShape,
});

/** The organisation's sign-in events with filters on user, outcome and date (B1.05; needs `security.manage`). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, QuerySchema);
    return listSignInEvents(
      ctx,
      { membershipId: query.membershipId, outcome: query.outcome, from: query.from, to: query.to },
      toPageRequest(query),
    );
  });
}
