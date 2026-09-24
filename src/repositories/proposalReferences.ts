import { withOrgContext } from "../db/orgScopedClient";

export interface CreateProposalReferenceInput {
  organizationId: string;
  dealId: string;
  proposalNumber: string;
  amount?: number | string;
  currency?: string;
  documentReference?: string;
  notes?: string;
  ownerMembershipId?: string;
}

export async function createProposalReference(
  input: CreateProposalReferenceInput,
) {
  return withOrgContext(input.organizationId, (tx) =>
    tx.proposalReference.create({
      data: {
        organizationId: input.organizationId,
        dealId: input.dealId,
        proposalNumber: input.proposalNumber,
        amount: input.amount,
        currency: input.currency,
        documentReference: input.documentReference,
        notes: input.notes,
        ownerMembershipId: input.ownerMembershipId,
      },
    }),
  );
}

export interface UpdateProposalReferenceInput {
  status?: "DRAFT" | "SENT" | "VIEWED" | "ACCEPTED" | "REJECTED" | "EXPIRED";
  sentAt?: Date | null;
  respondedAt?: Date | null;
  documentReference?: string | null;
  notes?: string | null;
}

export async function updateProposalReference(
  organizationId: string,
  proposalReferenceId: string,
  input: UpdateProposalReferenceInput,
) {
  return withOrgContext(organizationId, (tx) =>
    tx.proposalReference.update({
      where: { id: proposalReferenceId, organizationId },
      data: input,
    }),
  );
}

export async function getProposalReferenceById(
  organizationId: string,
  proposalReferenceId: string,
) {
  return withOrgContext(organizationId, (tx) =>
    tx.proposalReference.findFirst({
      where: { id: proposalReferenceId, organizationId },
    }),
  );
}

export async function listProposalReferencesByDeal(
  organizationId: string,
  dealId: string,
) {
  return withOrgContext(organizationId, (tx) =>
    tx.proposalReference.findMany({
      where: { organizationId, dealId },
      orderBy: { createdAt: "desc" },
    }),
  );
}
