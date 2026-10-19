import { hasPermission, type AuthContext } from "./context";

/** The two "account" record types that are shared org-wide rather than owned per-person. */
export type AccountKind = "companies" | "contacts";

/**
 * Companies and contacts are shared org-wide: anyone who can view them sees
 * every record, and anyone who can edit them can edit every record. There is
 * no own/all split like leads and deals have. What stays restricted is who
 * may *hand a record to someone else*: that needs edit rights plus
 * `membership.manage` (Management), the same people who run the team.
 *
 * Pure and dependency-free so both the services (the real gate) and the
 * pages (which only decide which controls to show) use the same rule.
 */
export function canAssignAccountOwner(
  ctx: AuthContext,
  kind: AccountKind,
): boolean {
  return hasPermission(ctx, `${kind}.edit`) && hasPermission(ctx, "membership.manage");
}

/** A person can own a company/contact only if they can open and edit it. */
export function canWorkAccounts(
  permissionKeys: string[],
  kind: AccountKind,
): boolean {
  return (
    permissionKeys.includes(`${kind}.view`) &&
    permissionKeys.includes(`${kind}.edit`)
  );
}
