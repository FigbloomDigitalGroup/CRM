/**
 * Q1.01 (FIG-1115): traceability from every V1 Screen Checklist ID (design-spec/TRACEABILITY.md, release "V1") to the Playwright spec files whose
 * journeys exercise it. `tests/e2eTraceability.test.ts` fails the build when a V1 ID has no entry, an entry points at a file that does not exist
 * or has no test in it, or the map names an ID the checklist does not have. Add the ID here in the same pull request that lands a screen.
 *
 * `qa/role-journeys` walks every desktop screen as every role and `qa/a11y-sweep`, `qa/visual` walk them again in every look; the other files
 * hold the screen-by-screen assertions. The mobile persona is `mobile-*`.
 */
export const V1_TRACE: Record<string, string[]> = {
  A1: ["frozen-auth", "auth"],
  A2: ["frozen-auth", "auth"],
  A3: ["frozen-auth", "auth"],
  // A4 Session expired: a session revoked from another device is refused on its next request and sent to sign in; the expiring prompt is TB3.
  A4: ["preferences", "ui-shell"],
  G1: ["ui-shell", "qa/role-journeys"],
  G2: ["home"],
  G3: ["home", "notifications"],
  D1: ["home", "qa/role-journeys"],
  D2: ["home", "qa/role-journeys"],
  D3: ["home", "qa/role-journeys"],
  L1: ["leads", "qa/role-journeys"],
  L2: ["leads", "lead-lifecycle"],
  L3: ["leads", "csv-import"],
  P1: ["deals", "qa/role-journeys"],
  P2: ["deals"],
  P3: ["deals"],
  P4: ["deals", "qa/role-journeys"],
  T1: ["tasks", "qa/role-journeys"],
  T2: ["tasks", "qa/role-journeys"],
  C1: ["customers", "qa/role-journeys"],
  C2: ["customers"],
  C3: ["contacts", "contacts-companies"],
  C4: ["merge"],
  R1: ["reports"],
  R2: ["home", "reports"],
  F1: ["payments"],
  S1: ["settings", "settings-admin"],
  S2: ["settings-admin"],
  // S3: notification preferences (Preferences) and PWA install and the offline queue (mobile).
  S3: ["preferences", "mobile-offline", "mobile-core"],
  S4: ["restricted-technical", "qa/role-journeys"],
  E1: ["conversations"],
  E2: ["renewals"],
  S5: ["settings-admin"],
  S6: ["settings-admin", "website-capture"],
  S7: ["settings-migration"],
  S8: ["settings-admin"],
  S9: ["settings-admin"],
  M1: ["mobile-core", "mobile-pages-375"],
  M2: ["mobile-core", "mobile-pages-375"],
  M3: ["mobile-core", "mobile-pages-375"],
  X1: ["record-extras"],
  "S5#2": ["settings-admin"],
  AP1: ["preferences"],
  AP2: ["preferences", "qa/a11y-sweep", "qa/visual"],
  AP3: ["preferences"],
  AP5: ["settings-admin"],
  AP6: ["preferences"],
  AP7: ["preferences"],
  AP8: ["preferences"],
  AP9: ["settings-admin"],
  TB1: ["ui-shell"],
  TB2: ["ui-shell"],
  TB3: ["ui-shell"],
  TB5: ["ui-shell", "mobile-pages-375"],
};

/**
 * Q2.01 (FIG-1179): the same map for the 29 V1.1 rows of the Screen Checklist. `tests/e2eV11Traceability.test.ts` checks it the way
 * `tests/e2eTraceability.test.ts` checks V1_TRACE. Several of these journeys need a server that has the V1.1 features on or the dev Super
 * Admin sign-in open; see `docs/V11_TEST_REPORT.md` for how each one is run and which file skips itself on the standard e2e server.
 */
export const V11_TRACE: Record<string, string[]> = {
  Q1: ["commercial"],
  Q3: ["commercial"],
  Q4: ["commercial"],
  X2: ["engage-tools"],
  X3: ["engage-tools"],
  X4: ["engage-tools"],
  "S6#2": ["commercial", "v11-settings"],
  "S7#2": ["engage-tools", "m10-orgside", "v11-settings"],
  A5: ["m10-orgside"],
  M4: ["engage-tools"],
  A6: ["dev-accounts-closed", "frozen-auth"],
  PL1: ["platform-console"],
  PL2: ["platform-console"],
  PL3: ["platform-console"],
  PL4: ["platform-console"],
  PL5: ["platform-console"],
  PL6: ["platform-console"],
  PL8: ["platform-console"],
  PL9: ["platform-console"],
  PL10: ["platform-console"],
  PL11: ["platform-console"],
  PL14: ["platform-console"],
  PL15: ["platform-console"],
  PLM: ["mobile-platform"],
  OS1: ["m10-orgside"],
  OS6: ["m10-orgside"],
  AP4: ["engage-tools"],
  TB4: ["m10-orgside"],
  TB6: ["platform-console"],
};
