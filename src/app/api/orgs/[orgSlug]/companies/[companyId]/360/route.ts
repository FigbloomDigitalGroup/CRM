import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { getCustomer360 } from "@/services/customer360Service";

const QuerySchema = z.object({
  /** Comma-separated: profile, services, deals, tasks, timeline, handoffs, payments, tickets, nextFollowUp, attachments, comments. Omit for all. */
  sections: z.string().max(200).optional(),
  /** The timeline's `nextCursor`. */
  cursor: z.string().max(400).optional(),
  limit: z.string().regex(/^\d+$/, "limit must be a whole number.").optional(),
});

// Customer 360 (design C2, FIG-1047): sections load independently; a section the role may not read comes back as no_access with who owns it.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; companyId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, companyId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, QuerySchema);
    return getCustomer360(ctx, companyId, {
      sections: query.sections ? query.sections.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
      cursor: query.cursor,
      limit: query.limit ? Number(query.limit) : undefined,
    });
  });
}
