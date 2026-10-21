import { canActOnOwnedRecord, hasPermission, type AuthContext } from "@/auth/context";

export interface LeadCapabilityInput {
  ownerMembershipId: string | null;
  archivedAt: Date | string | null;
  convertedAt: Date | string | null;
}

/**
 * What the signed-in member may do with one lead, in one place, so the
 * list, the row menu, the edit drawer and the detail page can never
 * disagree. This only decides which controls are shown -- the same rules
 * are enforced again in `leadService`, which is the real gate.
 */
export function leadCapabilities(ctx: AuthContext, lead: LeadCapabilityInput) {
  const archived = Boolean(lead.archivedAt);
  const converted = Boolean(lead.convertedAt);

  const mayEdit = canActOnOwnedRecord(
    ctx,
    "leads.edit.own",
    "leads.edit.all",
    lead.ownerMembershipId,
  );
  const mayArchive = canActOnOwnedRecord(
    ctx,
    "leads.archive.own",
    "leads.archive.all",
    lead.ownerMembershipId,
  );

  return {
    archived,
    converted,
    canEdit: mayEdit && !archived,
    canConvert:
      mayEdit && hasPermission(ctx, "leads.convert") && !archived && !converted,
    canArchive: mayArchive && !archived,
    canRestore: mayArchive && archived,
    // Reassigning is Management-only (`leads.assign`); a lead that is
    // archived or already converted has nothing left to hand over.
    canReassign: hasPermission(ctx, "leads.assign") && !archived && !converted,
    // For the "locked" affordance shown to people who can't reassign.
    reassignLocked: !hasPermission(ctx, "leads.assign"),
  };
}

export type LeadCapabilities = ReturnType<typeof leadCapabilities>;
