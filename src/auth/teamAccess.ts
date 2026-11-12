/**
 * Who may open the Team page (P2-15, FIG-1598). One small function, used by the API, the sidebar, the command palette and the screen, so
 * the rule lives in one place. Today it is Management only (the organisation-administration permission). When the Head of Sales role
 * arrives (P2-14), add its permission key to `TEAM_PAGE_KEYS` and nothing else changes.
 *
 * Pure and client-safe: it takes permission keys, never a role name (hard rule on role literals). Hiding the link is a courtesy; the
 * API checks this again on every route.
 */
export const TEAM_PAGE_KEYS: readonly string[] = ["configuration.manage"];

export function canViewTeamPage(permissionKeys: readonly string[]): boolean {
  return TEAM_PAGE_KEYS.some((k) => permissionKeys.includes(k));
}
