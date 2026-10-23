import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { pageQueryShape, toPageRequest } from "@/app/api/_lib/pageQuery";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { listTaskGroupPage } from "@/services/taskService";

const GroupPageQuerySchema = z.object({
  assigneeMembershipId: z.string().optional(),
  companyId: z.string().optional(),
  contactId: z.string().optional(),
  leadId: z.string().optional(),
  dealId: z.string().optional(),
  q: z.string().max(100).optional(),
  ...pageQueryShape,
});

// One page of one due-state group (server-side paging per group).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; group: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, group } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, GroupPageQuerySchema);
    return listTaskGroupPage(
      ctx,
      group.toUpperCase(),
      {
        assigneeMembershipId: query.assigneeMembershipId,
        companyId: query.companyId,
        contactId: query.contactId,
        leadId: query.leadId,
        dealId: query.dealId,
        query: query.q,
      },
      toPageRequest(query),
    );
  });
}
