import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { pageQueryShape, toPageRequest } from "@/app/api/_lib/pageQuery";
import { parseJsonBody, parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { ValidationError } from "@/auth/errors";
import {
  createActivity,
  listActivitiesPage,
  listTimelineActivitiesPage,
} from "@/services/activityService";

const CreateActivitySchema = z.object({
  type: z.enum(["CALL", "MEETING", "NOTE", "EMAIL", "WHATSAPP", "OTHER"]),
  subject: z.string().optional(),
  description: z.string().optional(),
  occurredAt: z.coerce.date().optional(),
  outcome: z.string().optional(),
  companyId: z.string().optional(),
  contactId: z.string().optional(),
  leadId: z.string().optional(),
  dealId: z.string().optional(),
});

/**
 * A timeline is always scoped to exactly one parent record -- there is no
 * unscoped "all activities" query. `q` picks which single query param is
 * honored; the others are ignored rather than combined, since combining
 * would silently change what's authorized (see activityService's
 * per-parent ownership check).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const { searchParams } = new URL(request.url);

    const companyId = searchParams.get("companyId");
    const contactId = searchParams.get("contactId");
    const leadId = searchParams.get("leadId");
    const dealId = searchParams.get("dealId");

    const page = toPageRequest(
      parseQueryParams(searchParams, z.object(pageQueryShape)),
    );

    if (companyId) return listTimelineActivitiesPage(ctx, { companyId }, page);
    if (contactId) return listTimelineActivitiesPage(ctx, { contactId }, page);
    if (leadId) return listActivitiesPage(ctx, { leadId }, page);
    if (dealId) return listActivitiesPage(ctx, { dealId }, page);
    throw new ValidationError(
      "One of companyId, contactId, leadId, or dealId is required.",
    );
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, CreateActivitySchema);
    return createActivity(ctx, body);
  });
}
