import type { ActiveMembership } from "../repositories/memberships";
import { ForbiddenError } from "./errors";

/**
 * The authorization context every service-layer function receives: an
 * already-resolved, active organization membership (FIG-437 section 7,
 * "Active Organization Context"). Never construct this from raw
 * client-supplied values — it must come from
 * `src/auth/requestContext.ts#resolveRequestContext`, which looks it up via
 * `resolveActiveMembership` against the authenticated user's session.
 */
export type AuthContext = ActiveMembership;

export function hasPermission(
  ctx: AuthContext,
  permissionKey: string,
): boolean {
  return ctx.permissionKeys.includes(permissionKey);
}

/** Fails closed: throws unless the resolved context carries the permission. */
export function requirePermission(
  ctx: AuthContext,
  permissionKey: string,
): void {
  if (!hasPermission(ctx, permissionKey)) {
    throw new ForbiddenError(permissionKey);
  }
}

/**
 * Common "own vs all" permission pattern used across Leads/Deals (FIG-437
 * section 9): the caller may act on any record with the "*.all"-style
 * permission, or only on records they own with the "*.own"-style
 * permission plus matching ownership.
 */
export function canActOnOwnedRecord(
  ctx: AuthContext,
  ownPermissionKey: string,
  allPermissionKey: string,
  ownerMembershipId: string | null,
): boolean {
  if (hasPermission(ctx, allPermissionKey)) {
    return true;
  }
  return (
    hasPermission(ctx, ownPermissionKey) &&
    ownerMembershipId === ctx.membershipId
  );
}

export function requireOwnedRecordPermission(
  ctx: AuthContext,
  ownPermissionKey: string,
  allPermissionKey: string,
  ownerMembershipId: string | null,
): void {
  if (
    !canActOnOwnedRecord(
      ctx,
      ownPermissionKey,
      allPermissionKey,
      ownerMembershipId,
    )
  ) {
    throw new ForbiddenError(
      `${ownPermissionKey} (own) or ${allPermissionKey} (all)`,
    );
  }
}
