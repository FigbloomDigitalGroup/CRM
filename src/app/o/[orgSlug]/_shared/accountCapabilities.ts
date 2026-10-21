import { canAssignAccountOwner, type AccountKind } from "@/auth/accountAccess";
import { hasPermission, type AuthContext } from "@/auth/context";

export interface AccountCapabilityInput {
  archivedAt: Date | string | null;
}

/**
 * What the signed-in member may do with one company or contact, in one
 * place, so the list, the row menu, the edit drawer and the detail page can
 * never disagree. This only decides which controls are shown -- the same
 * rules are enforced again in `companyService` / `contactService`, which
 * are the real gate.
 *
 * Companies and contacts are shared org-wide (no own/all split): holding
 * `edit` means you can edit any record. Reassigning the owner is the one
 * Management-only action. An archived record is read-only until restored.
 */
export function accountCapabilities(
  ctx: AuthContext,
  kind: AccountKind,
  record: AccountCapabilityInput,
) {
  const archived = Boolean(record.archivedAt);
  const mayAssign = canAssignAccountOwner(ctx, kind);
  return {
    archived,
    canEdit: hasPermission(ctx, `${kind}.edit`) && !archived,
    canArchive: hasPermission(ctx, `${kind}.archive`) && !archived,
    canRestore: hasPermission(ctx, `${kind}.archive`) && archived,
    canMerge: hasPermission(ctx, `${kind}.merge`) && !archived,
    canReassign: mayAssign && !archived,
    // For the "locked" affordance shown to people who can edit but not hand over.
    reassignLocked: hasPermission(ctx, `${kind}.edit`) && !mayAssign && !archived,
  };
}

export type AccountCapabilities = ReturnType<typeof accountCapabilities>;

export function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}
