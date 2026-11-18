import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { pageQueryShape, toPageRequest } from "@/app/api/_lib/pageQuery";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { listFormSubmissions } from "@/services/webFormService";

const QuerySchema = z.object({
  /** `false` is the rejected-submission log. */
  accepted: z.enum(["true", "false"]).optional(),
  outcome: z.string().optional(),
  ...pageQueryShape,
});

// Every attempt on a form, newest first, with the reason a submission was turned away and any duplicate warning (FIG-1151).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; formId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, formId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, QuerySchema);
    return listFormSubmissions(ctx, formId, {
      accepted: query.accepted === undefined ? undefined : query.accepted === "true",
      outcome: query.outcome,
      paging: toPageRequest(query),
    });
  });
}
