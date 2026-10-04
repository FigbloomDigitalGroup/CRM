import type { AuthContext } from "../auth/context";
import {
  hasPermission,
  requirePermission,
  requireOwnedRecordPermission,
} from "../auth/context";
import { NotFoundError, ValidationError } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import { recordAuditEvent } from "../repositories/auditEvents";
import {
  createDeal as createDealRecord,
  getDealById,
  listDeals as listDealsRecords,
  updateDeal as updateDealRecord,
  type CreateDealInput,
  type ListDealsFilters,
} from "../repositories/deals";
import { diffAuditedFields } from "./auditDiff";

/**
 * Beyond outcome (audited separately, below): other important field
 * changes (FIG-600 AC). `pipelineStageId` is only tracked here when the
 * move did NOT flip the outcome (open -> open) -- a won/lost-flipping move
 * is already fully captured by `deal.outcome_changed`, so including it
 * here too would just double-log the same transition.
 */
const AUDITED_DEAL_FIELDS = ["primaryContactId", "serviceId", "value", "currency"] as const;

export type CreateDealServiceInput = Omit<
  CreateDealInput,
  | "organizationId"
  | "createdByMembershipId"
  | "ownerMembershipId"
  | "expectedCloseDate"
> & { ownerMembershipId?: string; expectedCloseDate?: string };

type DealWithOwner = { ownerMembershipId: string; value: unknown };

/**
 * Reconciles "Sales cannot see cost or margin figures" with "deal values
 * are Management + Finance only" (FIG-297): the owner of a deal can see
 * the value they quoted themselves, but org-wide value visibility (e.g.
 * Delivery, which has deals.view.all but not deals.view.value) requires
 * the dedicated permission. Anyone else gets the value masked rather than
 * the whole deal withheld.
 */
function maskValue<T extends DealWithOwner>(
  ctx: AuthContext,
  deal: T,
): T & { valueMasked: boolean } {
  if (
    hasPermission(ctx, "deals.view.value") ||
    deal.ownerMembershipId === ctx.membershipId
  ) {
    return { ...deal, valueMasked: false };
  }
  return { ...deal, value: null, valueMasked: true };
}

export async function createDeal(
  ctx: AuthContext,
  input: CreateDealServiceInput,
) {
  requirePermission(ctx, "deals.create");
  const deal = await createDealRecord({
    ...input,
    organizationId: ctx.organizationId,
    createdByMembershipId: ctx.membershipId,
    ownerMembershipId: input.ownerMembershipId ?? ctx.membershipId,
    // Prisma throws (doesn't coerce) for a DateTime field given a
    // date-only string, so convert here. Bug existed since FIG-440
    // (CreateDealForm sends a plain "YYYY-MM-DD" string), caught in FIG-443.
    expectedCloseDate: input.expectedCloseDate
      ? new Date(input.expectedCloseDate)
      : undefined,
  });
  return maskValue(ctx, deal);
}

async function loadOwnedDeal(ctx: AuthContext, dealId: string) {
  const deal = await getDealById(ctx.organizationId, dealId);
  if (!deal) {
    throw new NotFoundError("Deal", dealId);
  }
  return deal;
}

/**
 * NotFoundError vs ForbiddenError follows the same convention as
 * leadService.ts: NotFoundError means the deal doesn't exist in the
 * caller's organization at all; ForbiddenError means it exists but the
 * caller's role/ownership doesn't permit the action.
 */
export async function getDeal(ctx: AuthContext, dealId: string) {
  const deal = await loadOwnedDeal(ctx, dealId);
  requireOwnedRecordPermission(
    ctx,
    "deals.view.own",
    "deals.view.all",
    deal.ownerMembershipId,
  );
  return maskValue(ctx, deal);
}

/**
 * Same "own filter is server-enforced, never client-trusted" rule as
 * leadService.listLeads.
 */
export async function listDeals(
  ctx: AuthContext,
  filters: ListDealsFilters = {},
) {
  let deals;
  if (hasPermission(ctx, "deals.view.all")) {
    deals = await listDealsRecords(ctx.organizationId, filters);
  } else {
    requirePermission(ctx, "deals.view.own");
    deals = await listDealsRecords(ctx.organizationId, {
      ...filters,
      ownerMembershipId: ctx.membershipId,
    });
  }
  return deals.map((deal) => maskValue(ctx, deal));
}

/**
 * Pipeline stage is the single source of truth for a deal's outcome:
 * moving onto a won-flagged stage records WON automatically, onto a
 * lost-flagged stage requires a lost reason, onto anything else reopens
 * it. This is the only path that sets outcome/wonAt/lostAt -- see
 * `UpdateDealInput` in repositories/deals.ts for why those are never
 * taken directly from client input.
 */
async function resolveOutcomeFields(
  organizationId: string,
  pipelineStageId: string,
  lostReasonId: string | null | undefined,
) {
  const stage = await adminDb.pipelineStage.findFirst({
    where: { id: pipelineStageId, organizationId },
  });
  if (!stage) {
    throw new ValidationError(
      "The selected pipeline stage was not found in this organization.",
    );
  }

  if (stage.isWon) {
    return {
      outcome: "WON" as const,
      wonAt: new Date(),
      lostAt: null,
      lostReasonId: null,
    };
  }
  if (stage.isLost) {
    if (!lostReasonId) {
      throw new ValidationError(
        "A lost reason is required when moving a deal to a lost pipeline stage.",
      );
    }
    return {
      outcome: "LOST" as const,
      wonAt: null,
      lostAt: new Date(),
      lostReasonId,
    };
  }
  return {
    outcome: "OPEN" as const,
    wonAt: null,
    lostAt: null,
    lostReasonId: null,
  };
}

export interface UpdateDealServiceInput {
  primaryContactId?: string | null;
  serviceId?: string | null;
  pipelineStageId?: string;
  lostReasonId?: string | null;
  value?: number | string | null;
  currency?: string;
  expectedCloseDate?: string | null;
  notes?: string | null;
}

export async function updateDeal(
  ctx: AuthContext,
  dealId: string,
  input: UpdateDealServiceInput,
) {
  const deal = await loadOwnedDeal(ctx, dealId);
  requireOwnedRecordPermission(
    ctx,
    "deals.edit.own",
    "deals.edit.all",
    deal.ownerMembershipId,
  );

  const outcomeFields = input.pipelineStageId
    ? await resolveOutcomeFields(
        ctx.organizationId,
        input.pipelineStageId,
        input.lostReasonId,
      )
    : undefined;

  const updated = await updateDealRecord(ctx.organizationId, dealId, {
    primaryContactId: input.primaryContactId,
    serviceId: input.serviceId,
    value: input.value,
    currency: input.currency,
    expectedCloseDate:
      input.expectedCloseDate === undefined
        ? undefined
        : input.expectedCloseDate
          ? new Date(input.expectedCloseDate)
          : null,
    notes: input.notes,
    pipelineStageId: input.pipelineStageId,
    ...outcomeFields,
  });

  // Outcome changes (won/lost/reopened) are auditable (FIG-441 AC) --
  // only recorded when the stage transition actually flipped the outcome,
  // not on every unrelated field edit.
  const outcomeChanged = Boolean(outcomeFields && outcomeFields.outcome !== deal.outcome);
  if (outcomeFields && outcomeChanged) {
    await recordAuditEvent({
      organizationId: ctx.organizationId,
      actorMembershipId: ctx.membershipId,
      action: "deal.outcome_changed",
      entityType: "Deal",
      entityId: dealId,
      previousValue: { outcome: deal.outcome, pipelineStageId: deal.pipelineStageId },
      newValue: { outcome: outcomeFields.outcome, pipelineStageId: input.pipelineStageId },
    });
  }

  // Broadened beyond outcome to other important field changes (FIG-600
  // AC) -- re-pointing the primary contact/service, value, currency, or
  // (when it didn't also flip the outcome) moving between two open
  // pipeline stages, bundled into one event.
  const trackedFields = outcomeChanged
    ? AUDITED_DEAL_FIELDS
    : [...AUDITED_DEAL_FIELDS, "pipelineStageId"];
  const diff = diffAuditedFields(deal, input, trackedFields);
  if (diff) {
    await recordAuditEvent({
      organizationId: ctx.organizationId,
      actorMembershipId: ctx.membershipId,
      action: "deal.updated",
      entityType: "Deal",
      entityId: dealId,
      previousValue: diff.previousValue,
      newValue: diff.newValue,
    });
  }

  return maskValue(ctx, updated);
}
