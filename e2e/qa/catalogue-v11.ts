import type { Screen } from "./catalogue";

/**
 * Q2.02 (FIG-1180): the V1.1 screens the accessibility sweep and the visual baselines walk. A separate file so the V1 catalogue stays as signed off.
 * `ids` are best-effort design Screen Checklist IDs (design-spec/TRACEABILITY.md); where no confirmed ID is known the list is empty.
 * Org paths are under `/o/{org}`; platform paths are absolute and need the dev Super Admin.
 */

export interface V11Screen extends Screen {
  note?: string;
}

/** Organisation-side V1.1 screens (paths under `/o/{org}`), signed in as Management. */
export const V11_SCREENS: V11Screen[] = [
  { name: "quotes", path: "/quotes", ids: [], note: "quotes list" },
  { name: "approvals", path: "/approvals", ids: [] },
  { name: "forecast", path: "/forecast", ids: [] },
  { name: "chat", path: "/chat", ids: [] },
  { name: "mail", path: "/mail", ids: [] },
  { name: "video", path: "/video", ids: [], note: "video conference and meetings" },
  { name: "settings-catalogue", path: "/settings?tab=catalogue", ids: ["S6"] },
  { name: "settings-pipelines", path: "/settings?tab=pipelines", ids: [] },
  { name: "settings-sequences", path: "/settings?tab=sequences", ids: [] },
  { name: "settings-webforms", path: "/settings?tab=webforms", ids: [] },
  { name: "settings-approvalrules", path: "/settings?tab=approvalrules", ids: [] },
  { name: "settings-connect", path: "/settings?tab=connect", ids: [], note: "email and calendar" },
  { name: "settings-ai", path: "/settings?tab=ai", ids: ["S6"], note: "AI assistant" },
  { name: "settings-twofa", path: "/settings?tab=twofa", ids: ["S7"] },
  { name: "help", path: "/help", ids: ["X3"] },
  { name: "whats-new", path: "/help/whats-new", ids: ["X3"] },
  // Saved views live in the toolbar of the V1 list screens, so they are checked on those lists.
  { name: "saved-views-leads", path: "/leads", ids: [], note: "saved views toolbar" },
  { name: "saved-views-deals", path: "/deals", ids: [], note: "saved views toolbar" },
  { name: "preferences-colours", path: "/preferences?tab=appearance", ids: ["AP4"], note: "own colours" },
  { name: "suspended", path: "/suspended", ids: [] },
];

/** Org-side mobile screens at 375 px that are new in V1.1 (card capture and photo attach start from the phone leads list and the sync screen). */
export const V11_MOBILE_SCREENS: V11Screen[] = [
  { name: "m-sync", path: "/m/sync", ids: ["M4"] },
  { name: "m-capture", path: "/m/leads", ids: [], note: "card capture and photo attach start from the phone leads list" },
];

/** Outside `/o/{org}`: the two-step sign-in pages. */
export const V11_TOP_LEVEL: V11Screen[] = [
  { name: "two-step", path: "/two-step", ids: ["AP5"] },
  { name: "two-step-setup", path: "/two-step/setup", ids: ["AP5"] },
];

/** Platform console (dev Super Admin only). PL numbers follow the console menu order; confirm against the checklist. */
export const V11_PLATFORM_SCREENS: V11Screen[] = [
  { name: "pl-home", path: "/platform", ids: ["PL1"] },
  { name: "pl-organisations", path: "/platform/organisations", ids: ["PL2"] },
  { name: "pl-organisation-new", path: "/platform/organisations/new", ids: ["PL3"] },
  { name: "pl-admins", path: "/platform/admins", ids: ["PL4"] },
  { name: "pl-audit", path: "/platform/audit", ids: ["PL6"] },
  { name: "pl-data-requests", path: "/platform/data-requests", ids: ["PL7"] },
  { name: "pl-health", path: "/platform/health", ids: ["PL9"] },
  { name: "pl-preferences", path: "/platform/preferences", ids: ["PL10"] },
  { name: "pl-security", path: "/platform/security", ids: ["PL11"] },
];

/** Platform mobile (the phone console). */
export const V11_PLATFORM_MOBILE: V11Screen[] = [
  { name: "plm-home", path: "/platform/m", ids: ["PL13"] },
  { name: "plm-approvals", path: "/platform/m/approvals", ids: ["PL14"] },
  { name: "plm-health", path: "/platform/m/health", ids: ["PL15"] },
];

export const SUPER_ADMIN = "dev.superadmin@platform.figbloom.local";

