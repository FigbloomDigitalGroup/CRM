import { canActOnOwnedRecord, hasPermission, type AuthContext } from "@/auth/context";

export interface DealCapabilityInput {
  ownerMembershipId: string;
  archivedAt: Date | string | null;
}

/**
 * What the signed-in member may do with one deal. Mirrors `dealService`
 * (the real gate): editing needs `deals.edit.own/all`, an archived deal is
 * read-only until restored, and reassigning is limited to people who can
 * edit every deal (Management) -- Sales can work their own deals but never
 * hand them on. Only decides which controls are shown.
 */
export function dealCapabilities(ctx: AuthContext, deal: DealCapabilityInput) {
  const archived = Boolean(deal.archivedAt);
  const mayEdit = canActOnOwnedRecord(
    ctx,
    "deals.edit.own",
    "deals.edit.all",
    deal.ownerMembershipId,
  );
  const mayArchive = canActOnOwnedRecord(
    ctx,
    "deals.archive.own",
    "deals.archive.all",
    deal.ownerMembershipId,
  );
  return {
    archived,
    canEdit: mayEdit && !archived,
    canArchive: mayArchive && !archived,
    canRestore: mayArchive && archived,
    canReassign: hasPermission(ctx, "deals.edit.all") && !archived,
    reassignLocked: !hasPermission(ctx, "deals.edit.all"),
  };
}

export type DealCapabilities = ReturnType<typeof dealCapabilities>;
