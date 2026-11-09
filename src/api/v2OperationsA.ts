/**
 * Lane A of the V2 backend (M17): support access (FIG-1183, B7.01), flags and limits (FIG-1184, B7.02) and announcements (FIG-1185, B7.03).
 *
 * None of these routes is in the frozen V1 contract (`openapi.v1.json`); they are listed here as deliberately left out of it, with the reason,
 * and `tests/apiContract.test.ts` checks that each is a real route. They join the V2 contract when it is frozen at G3.01 (FIG-1191).
 * `accountOperations.ts` spreads this map into `NOT_IN_V1_CONTRACT`.
 */
const SUPPORT = "Support access, V2 (B7.01, FIG-1183)";
const FLAGS = "Flags and limits, V2 (B7.02, FIG-1184)";
const ANNOUNCEMENTS = "Announcements, V2 (B7.03, FIG-1185)";

export const LANE_A_NOT_IN_V1_CONTRACT: Record<string, string> = {
  "/api/platform/support-access": SUPPORT,
  "/api/platform/support-access/{grantId}": SUPPORT,
  "/api/platform/support-access/{grantId}/open": SUPPORT,
  "/api/platform/support-access/{grantId}/end": SUPPORT,
  "/api/platform/support-access/{grantId}/read": SUPPORT,
  "/api/orgs/{orgSlug}/support-access": SUPPORT,
  "/api/orgs/{orgSlug}/support-access/banner": SUPPORT,
  "/api/orgs/{orgSlug}/support-access/{grantId}": SUPPORT,
  "/api/orgs/{orgSlug}/support-access/{grantId}/decision": SUPPORT,
  "/api/orgs/{orgSlug}/support-access/{grantId}/end": SUPPORT,
  "/api/platform/organizations/{organizationId}/flags": FLAGS,
  "/api/platform/announcements": ANNOUNCEMENTS,
  "/api/platform/announcements/{announcementId}": ANNOUNCEMENTS,
  "/api/orgs/{orgSlug}/announcements": ANNOUNCEMENTS,
  "/api/orgs/{orgSlug}/announcements/{announcementId}/dismiss": ANNOUNCEMENTS,
};
