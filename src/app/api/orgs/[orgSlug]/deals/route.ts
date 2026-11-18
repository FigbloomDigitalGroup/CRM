import { adminDb } from "@/db/adminClient";
import { inactiveStageCutoffs, loadStageRules, signalsForDeal } from "@/services/dealRuleService";
import { customFieldFilters } from "@/app/api/_lib/pageQuery";
import { buildCustomFieldWhere } from "@/services/customFieldService";
import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { pageQueryShape, toPageRequest } from "@/app/api/_lib/pageQuery";
import { parseJsonBody, parseQueryParams, requiredString } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { createDeal, listDealsPage } from "@/services/dealService";

const OutcomeEnum = z.enum(["OPEN", "WON", "LOST"]);

const ListDealsQuerySchema = z.object({
  /** Records carrying any of these tags (comma-separated tag ids). */
  tagId: z.string().max(400).optional(),
  q: z.string().optional(),
  ownerMembershipId: z.string().optional(),
  pipelineStageId: z.string().optional(),
  outcome: OutcomeEnum.optional(),
  companyId: z.string().optional(),
  includeArchived: z.enum(["true", "false"]).optional(),
  /** The archived tab: only archived records. */
  archivedOnly: z.enum(["true", "false"]).optional(),
  /** Open deals with no activity for longer than their stage allows (FIG-1035). */
  stalled: z.enum(["true", "false"]).optional(),
  /** Open deals whose expected close date has passed (FIG-1035). */
  closeDatePassed: z.enum(["true", "false"]).optional(),
  ...pageQueryShape,
});

const CreateDealSchema = z.object({
  /** Organisation-defined custom field values (FIG-803); a field sent as null is cleared. */
  customFields: z.record(z.string(), z.any()).optional(),
  companyId: requiredString("companyId is required."),
  primaryContactId: z.string().optional(),
  serviceId: z.string().optional(),
  ownerMembershipId: z.string().optional(),
  pipelineStageId: requiredString("pipelineStageId is required."),
  value: z.union([z.number(), z.string()]).optional(),
  currency: z.string().optional(),
  // Deliberately a string, not z.coerce.date() -- dealService.createDeal
  // does its own new Date() conversion (a date-only "YYYY-MM-DD" string
  // needs different handling than a full ISO datetime; see its comment).
  expectedCloseDate: z.string().optional(),
  notes: z.string().optional(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const { searchParams } = new URL(request.url);
    const customFieldClauses = await buildCustomFieldWhere(ctx.organizationId, "DEAL", customFieldFilters(searchParams));
    const query = parseQueryParams(searchParams, ListDealsQuerySchema);
    const rules = await loadStageRules(ctx.organizationId);
    const stages = query.stalled === "true" ? await adminDb.pipelineStage.findMany({ where: { organizationId: ctx.organizationId, isWon: false, isLost: false }, select: { id: true } }) : [];
    const page = await listDealsPage(
      ctx,
      {
        query: query.q,
        ownerMembershipId: query.ownerMembershipId,
        pipelineStageId: query.pipelineStageId,
        outcome: query.outcome,
        companyId: query.companyId,
        includeArchived: query.includeArchived === "true",
        archivedOnly: query.archivedOnly === "true",
        customFieldClauses,
        tagIds: query.tagId ? query.tagId.split(",").filter(Boolean) : undefined,
        inactiveStages: query.stalled === "true" ? inactiveStageCutoffs(stages.map((s) => s.id), rules) : undefined,
        closeDatePassed: query.closeDatePassed === "true",
      },
      toPageRequest(query),
    );
    // Stalled and close-date flags ride on every row (B2.06).
    return { ...page, items: page.items.map((d) => ({ ...d, signals: signalsForDeal(d, rules) })) };
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, CreateDealSchema);
    return createDeal(ctx, body);
  });
}
