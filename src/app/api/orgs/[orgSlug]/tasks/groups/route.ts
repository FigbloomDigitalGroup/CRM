import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { listTasksGrouped } from "@/services/taskService";

const GroupsQuerySchema = z.object({
  /** Comma-separated groups to return: OVERDUE, TODAY, THIS_WEEK, LATER, NO_DATE, DONE. Default: all (Done collapsed). */
  groups: z.string().max(100).optional(),
  pageSize: z.string().regex(/^\d+$/).optional(),
  assigneeMembershipId: z.string().optional(),
  companyId: z.string().optional(),
  contactId: z.string().optional(),
  leadId: z.string().optional(),
  dealId: z.string().optional(),
  q: z.string().max(100).optional(),
});

// Tasks in due-state groups with a count per group and the first page of each (FIG-1038, B2.09).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, GroupsQuerySchema);
    return listTasksGrouped(ctx, {
      groups: query.groups?.split(",").map((g) => g.trim()).filter(Boolean),
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
      filters: {
        assigneeMembershipId: query.assigneeMembershipId,
        companyId: query.companyId,
        contactId: query.contactId,
        leadId: query.leadId,
        dealId: query.dealId,
        query: query.q,
      },
    });
  });
}
