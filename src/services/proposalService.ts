import type { AuthContext } from "../auth/context";
import { requirePermission, requireOwnedRecordPermission } from "../auth/context";
import { NotFoundError } from "../auth/errors";
import { getDealById } from "../repositories/deals";
import {
  createProposalReference as createProposalReferenceRecord,
  getProposalReferenceById,
  listProposalReferencesByDeal,
  updateProposalReference as updateProposalReferenceRecord,
  type UpdateProposalReferenceInput,
} from "../repositories/proposalReferences";

/**
 * Proposal references have no own/all permission split (only
 * `proposals.view`/`proposals.manage`), so this reuses the parent Deal's
 * own/all ownership gate: a caller may only view or manage proposals on a
 * deal they're already allowed to view/edit. This also stops a Sales rep
 * with `proposals.manage` from touching a colleague's proposals by
 * guessing the deal id.
 */
async function loadOwnedDealForProposals(ctx: AuthContext, dealId: string) {
  const deal = await getDealById(ctx.organizationId, dealId);
  if (!deal) {
    throw new NotFoundError("Deal", dealId);
  }
  return deal;
}

export async function listProposalReferences(ctx: AuthContext, dealId: string) {
  const deal = await loadOwnedDealForProposals(ctx, dealId);
  requirePermission(ctx, "proposals.view");
  requireOwnedRecordPermission(
    ctx,
    "deals.view.own",
    "deals.view.all",
    deal.ownerMembershipId,
  );
  return listProposalReferencesByDeal(ctx.organizationId, dealId);
}

export interface CreateProposalReferenceServiceInput {
  proposalNumber: string;
  amount?: number | string;
  currency?: string;
  documentReference?: string;
  notes?: string;
}

export async function createProposalReference(
  ctx: AuthContext,
  dealId: string,
  input: CreateProposalReferenceServiceInput,
) {
  const deal = await loadOwnedDealForProposals(ctx, dealId);
  requirePermission(ctx, "proposals.manage");
  requireOwnedRecordPermission(
    ctx,
    "deals.edit.own",
    "deals.edit.all",
    deal.ownerMembershipId,
  );

  return createProposalReferenceRecord({
    organizationId: ctx.organizationId,
    dealId,
    proposalNumber: input.proposalNumber,
    amount: input.amount,
    currency: input.currency,
    documentReference: input.documentReference,
    notes: input.notes,
    ownerMembershipId: ctx.membershipId,
  });
}

const STATUS_TIMESTAMP_FIELDS: Record<
  NonNullable<UpdateProposalReferenceInput["status"]>,
  Partial<UpdateProposalReferenceInput>
> = {
  DRAFT: {},
  SENT: { sentAt: new Date() },
  VIEWED: {},
  ACCEPTED: { respondedAt: new Date() },
  REJECTED: { respondedAt: new Date() },
  EXPIRED: {},
};

export async function updateProposalReferenceStatus(
  ctx: AuthContext,
  dealId: string,
  proposalReferenceId: string,
  status: NonNullable<UpdateProposalReferenceInput["status"]>,
) {
  const deal = await loadOwnedDealForProposals(ctx, dealId);
  requirePermission(ctx, "proposals.manage");
  requireOwnedRecordPermission(
    ctx,
    "deals.edit.own",
    "deals.edit.all",
    deal.ownerMembershipId,
  );

  const proposal = await getProposalReferenceById(
    ctx.organizationId,
    proposalReferenceId,
  );
  if (!proposal || proposal.dealId !== dealId) {
    throw new NotFoundError("ProposalReference", proposalReferenceId);
  }

  return updateProposalReferenceRecord(ctx.organizationId, proposalReferenceId, {
    status,
    ...STATUS_TIMESTAMP_FIELDS[status],
  });
}
