import type { Prisma } from "@prisma/client";
import { auditCustomFieldChanges, prepareCustomFields } from "./customFieldService";
import { assertWritable, cleanArchiveReason } from "../lib/archive";
import { maskDeal } from "../auth/masking";
import type { AuthContext } from "../auth/context";
import {
  deny,
  hasPermission,
  requirePermission,
  requireOwnedRecordPermission,
} from "../auth/context";
import { NotFoundError, ValidationError } from "../auth/errors";
import { canUseResource, viewPermissionKeys } from "../auth/permissions";
import { assertRecordVisible } from "../auth/visibility";
import { adminDb } from "../db/adminClient";
import { recordAuditEvent } from "../repositories/auditEvents";
import {
  archiveDeal as archiveDealRecord,
  createDeal as createDealRecord,
  getDealById,
  countDeals as countDealsRecords,
  listDeals as listDealsRecords,
  summarizeDeals as summarizeDealsRecords,
  restoreDeal as restoreDealRecord,
  updateDeal as updateDealRecord,
  type CreateDealInput,
  type ListDealsFilters,
} from "../repositories/deals";
import { diffAuditedFields } from "./auditDiff";
import {
  assertEligibleDealOwner,
  listDealOwnerCandidates,
} from "./ownerEligibility";
import { buildPage, resolvePaging, type PageRequest } from "../lib/pagination";
import { assertValidHandoffOwner, startDealWonHandoff, type HandoffOptions } from "./handoffService";
import { rescoreCompanyQuietly } from "./scoreEngine";
import { invalidateSignals } from "./signalService";
import { touchDealActivity } from "../repositories/deals";

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
  return maskDeal(ctx, deal);
}

/**
 * Deals have no dedicated "assign" permission; handing a deal to someone
 * else is reserved for people who can edit every deal (`deals.edit.all`,
 * i.e. Management). Someone with only `deals.edit.own` (Sales) can work the
 * deals they own but can never move them to another person -- same shape as
 * `leads.assign` on leads.
 */
function canReassignDeals(ctx: AuthContext): boolean {
  return hasPermission(ctx, "deals.edit.all");
}

/** Owners a deal may be handed to: active members whose role can view and edit deals. */
export async function listAssignableDealOwners(ctx: AuthContext) {
  if (!canReassignDeals(ctx)) {
    throw deny(ctx, "deals.edit.all (to choose a deal owner)", ["deals.edit.all"]);
  }
  return listDealOwnerCandidates(ctx.organizationId);
}

/**
 * Display names for deal owners, so every role that can see a deal can see
 * who owns it. The organization member list itself stays Management-only
 * (`membership.view`); this only resolves the ids the caller already sees
 * on deals they are allowed to view.
 */
export async function getDealOwnerNames(
  ctx: AuthContext,
  membershipIds: string[],
): Promise<Record<string, string>> {
  if (!canUseResource(ctx, "deals")) {
    throw deny(ctx, "deals.view", viewPermissionKeys("deals"));
  }
  const ids = [...new Set(membershipIds)];
  if (ids.length === 0) return {};
  const memberships = await adminDb.membership.findMany({
    where: { organizationId: ctx.organizationId, id: { in: ids } },
    include: { user: true },
  });
  return Object.fromEntries(memberships.map((m) => [m.id, m.user.name]));
}

export async function createDeal(
  ctx: AuthContext,
  input: CreateDealServiceInput,
) {
  requirePermission(ctx, "deals.create");

  // The creator owns what they create. Naming a different owner is a
  // reassignment in all but name, so it needs the same authority as
  // `assignDeal` and the person must actually be able to work deals.
  let ownerMembershipId = ctx.membershipId;
  if (
    input.ownerMembershipId &&
    input.ownerMembershipId !== ctx.membershipId
  ) {
    if (!canReassignDeals(ctx)) {
      throw deny(ctx, "deals.edit.all (to create a deal for someone else)", ["deals.edit.all"]);
    }
    await assertEligibleDealOwner(ctx.organizationId, input.ownerMembershipId);
    ownerMembershipId = input.ownerMembershipId;
  }

  // A deal is created open. Won/Lost are only reached by moving an
  // existing deal (that is the path that records the outcome and, for
  // Lost, the reason) -- creating straight into one would leave a deal on a
  // closed stage whose outcome still says OPEN.
  const stage = await adminDb.pipelineStage.findFirst({
    where: { id: input.pipelineStageId, organizationId: ctx.organizationId },
  });
  if (!stage) {
    throw new ValidationError(
      "The selected pipeline stage was not found in this organization.",
    );
  }
  if (stage.isWon || stage.isLost) {
    throw new ValidationError(
      "A new deal must start in an open pipeline stage.",
    );
  }

  const custom = await prepareCustomFields(ctx.organizationId, "DEAL", {
    incoming: input.customFields as Record<string, unknown> | undefined,
    mode: "create",
  });

  const deal = await createDealRecord({
    ...input,
    customFields: custom?.values as Prisma.InputJsonValue | undefined,
    organizationId: ctx.organizationId,
    createdByMembershipId: ctx.membershipId,
    ownerMembershipId,
    // Prisma throws (doesn't coerce) for a DateTime field given a
    // date-only string, so convert here. Bug existed since FIG-440
    // (CreateDealForm sends a plain "YYYY-MM-DD" string), caught in FIG-443.
    expectedCloseDate: input.expectedCloseDate
      ? new Date(input.expectedCloseDate)
      : undefined,
  });
  await invalidateSignals(ctx.organizationId);
  return maskValue(ctx, deal);
}

async function loadOwnedDeal(ctx: AuthContext, dealId: string) {
  const deal = await getDealById(ctx.organizationId, dealId);
  if (!deal) {
    throw new NotFoundError("Deal", dealId);
  }
  // A deal the caller cannot see answers 404, same as one that does not exist.
  assertRecordVisible(ctx, "deals", "Deal", dealId, deal);
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
  return maskValue(ctx, deal);
}

/**
 * Same "own filter is server-enforced, never client-trusted" rule as
 * leadService.listLeads.
 */
function scopeDealFilters(
  ctx: AuthContext,
  filters: ListDealsFilters,
): ListDealsFilters {
  if (hasPermission(ctx, "deals.view.all")) return filters;
  if (hasPermission(ctx, "deals.view.own")) {
    return { ...filters, ownerMembershipId: ctx.membershipId };
  }
  // Won-only viewers (Delivery and Finance while departure.won_only is on).
  if (hasPermission(ctx, "deals.view.won")) {
    return { ...filters, visibleOutcome: "WON" };
  }
  throw deny(ctx, "deals.view", viewPermissionKeys("deals"));
}

/** Every matching deal, unpaged -- internal use; list screens and the API use `listDealsPage` (FIG-789). */
export async function listDeals(
  ctx: AuthContext,
  filters: ListDealsFilters = {},
) {
  const deals = await listDealsRecords(
    ctx.organizationId,
    scopeDealFilters(ctx, filters),
  );
  return deals.map((deal) => maskValue(ctx, deal));
}

/** One page of deals plus the total; values are masked exactly as in `listDeals` (FIG-789). */
export async function listDealsPage(
  ctx: AuthContext,
  filters: ListDealsFilters = {},
  request: PageRequest = {},
) {
  const scoped = scopeDealFilters(ctx, filters);
  const paging = resolvePaging(request);
  const [deals, total] = await Promise.all([
    listDealsRecords(ctx.organizationId, {
      ...scoped,
      take: paging.take,
      skip: paging.skip,
    }),
    countDealsRecords(ctx.organizationId, scoped),
  ]);
  return buildPage(
    deals.map((deal) => maskValue(ctx, deal)),
    total,
    paging,
  );
}

/** How many deals this caller can see for `filters` -- a COUNT, never a row fetch (FIG-789). */
export async function countDeals(
  ctx: AuthContext,
  filters: ListDealsFilters = {},
) {
  return countDealsRecords(ctx.organizationId, scopeDealFilters(ctx, filters));
}

/**
 * The dashboard's deal numbers from COUNT/SUM aggregates instead of
 * loading every deal (FIG-789). Same own/all scoping and value masking as
 * `listDeals`: the open-pipeline total is only reported when every open
 * deal's value is visible to this caller (`deals.view.value`, or they own
 * it), every open deal has a value, and they share one currency -- a total
 * that silently left deals out would be wrong, so it is omitted instead.
 */
export async function getDealSummary(ctx: AuthContext) {
  const summary = await summarizeDealsRecords(
    ctx.organizationId,
    scopeDealFilters(ctx, {}),
    ctx.membershipId,
  );

  const valuesVisible =
    hasPermission(ctx, "deals.view.value") ||
    summary.openNotOwnedByViewer === 0;
  const [only] = summary.openByCurrency;
  const openValue =
    summary.open > 0 &&
    valuesVisible &&
    summary.openByCurrency.length === 1 &&
    only!.valuedCount === only!.count
      ? { currency: only!.currency, amount: only!.sum }
      : null;

  return {
    total: summary.total,
    open: summary.open,
    won: summary.won,
    lost: summary.lost,
    openValue,
  };
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
  /** Organisation-defined custom fields (FIG-803); a field sent as null is cleared. */
  customFields?: Record<string, unknown>;
  /**
   * Only read when this update moves the deal to a won stage (FIG-792):
   * who in Delivery receives the onboarding tasks. Defaults to the deal's
   * owner. The handoff dialog (F2.06) sends this.
   */
  handoff?: HandoffOptions;
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

  assertWritable(ctx, "deal", deal, "making changes");

  const custom = await prepareCustomFields(ctx.organizationId, "DEAL", {
    existing: deal.customFields as Record<string, unknown>,
    incoming: input.customFields,
    mode: "update",
  });

  const outcomeFields = input.pipelineStageId
    ? await resolveOutcomeFields(
        ctx.organizationId,
        input.pipelineStageId,
        input.lostReasonId,
      )
    : undefined;

  // A bad Delivery owner must fail the request before the deal changes,
  // not leave a won deal with no handoff.
  const becomingWon =
    outcomeFields?.outcome === "WON" && deal.outcome !== "WON";
  if (becomingWon) {
    await assertValidHandoffOwner(
      ctx.organizationId,
      input.handoff?.deliveryOwnerMembershipId,
    );
  }

  const updated = await updateDealRecord(ctx.organizationId, dealId, {
    customFields: custom?.values as Prisma.InputJsonValue | undefined,
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

  if (custom) await auditCustomFieldChanges(ctx, "Deal", dealId, custom.changes);
  if (outcomeChanged) await rescoreCompanyQuietly(ctx.organizationId, deal.companyId);
  await invalidateSignals(ctx.organizationId);
  if (input.pipelineStageId && input.pipelineStageId !== deal.pipelineStageId) await touchDealActivity(ctx.organizationId, dealId);

  // Winning a deal hands it to Delivery (FIG-792). Idempotent per deal: a
  // deal that is re-opened and won again does not get a second handoff.
  if (becomingWon) {
    await startDealWonHandoff(
      ctx,
      {
        id: dealId,
        companyId: deal.companyId,
        serviceId: updated.serviceId,
        ownerMembershipId: deal.ownerMembershipId,
      },
      input.handoff ?? {},
    );
  }

  return maskValue(ctx, updated);
}

/**
 * Reassigns a deal. Management only (see `canReassignDeals`); the new
 * owner must be someone whose role can work deals, and an archived deal
 * has to be restored first.
 */
export async function assignDeal(
  ctx: AuthContext,
  dealId: string,
  newOwnerMembershipId: string,
) {
  if (!canReassignDeals(ctx)) {
    throw deny(ctx, "deals.edit.all (to reassign a deal)", ["deals.edit.all"]);
  }
  const deal = await loadOwnedDeal(ctx, dealId);
  assertWritable(ctx, "deal", deal, "reassigning it");
  const target = await assertEligibleDealOwner(
    ctx.organizationId,
    newOwnerMembershipId,
  );
  if (target.id === deal.ownerMembershipId) {
    return maskValue(ctx, deal);
  }

  const reassigned = await updateDealRecord(ctx.organizationId, dealId, {
    ownerMembershipId: target.id,
  });

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "deal.owner_reassigned",
    entityType: "Deal",
    entityId: dealId,
    previousValue: { ownerMembershipId: deal.ownerMembershipId },
    newValue: { ownerMembershipId: target.id },
  });

  return maskValue(ctx, reassigned);
}

/** Soft-delete (FIG-601) -- own/all split, same tier as `deals.edit.own/.all`. */
export async function archiveDeal(ctx: AuthContext, dealId: string, input: { reason?: string | null } = {}) {
  const deal = await loadOwnedDeal(ctx, dealId);
  requireOwnedRecordPermission(
    ctx,
    "deals.archive.own",
    "deals.archive.all",
    deal.ownerMembershipId,
  );
  if (deal.archivedAt) {
    throw new ValidationError("This deal is already archived.");
  }

  const reason = cleanArchiveReason(input.reason);
  const archived = await archiveDealRecord(ctx.organizationId, dealId, {
    membershipId: ctx.membershipId,
    reason,
  });

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "deal.archived",
    entityType: "Deal",
    entityId: dealId,
    metadata: reason ? { reason } : undefined,
  });

  return maskValue(ctx, archived);
}

export async function restoreDeal(ctx: AuthContext, dealId: string) {
  const deal = await loadOwnedDeal(ctx, dealId);
  requireOwnedRecordPermission(
    ctx,
    "deals.archive.own",
    "deals.archive.all",
    deal.ownerMembershipId,
  );
  if (!deal.archivedAt) {
    throw new ValidationError("This deal is not archived.");
  }

  const restored = await restoreDealRecord(ctx.organizationId, dealId);

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "deal.restored",
    entityType: "Deal",
    entityId: dealId,
  });

  return maskValue(ctx, restored);
}
