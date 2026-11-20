/**
 * UC-F4 (Security S-1, part 1): the first-pass classification of every file that uses `adminDb` on tenant data.
 *
 * The owner connection (`adminDb`) bypasses row-level security, so a use on tenant data is safe only because its own `where` names the
 * organisation. Four jobs have a real reason to be on the owner connection and are ALLOWED; everything else that touches tenant data is
 * `tenant-data`: grandfathered in the allow-list so the suite stays green, and migrated to `withOrgContext` by UC-F5, one service at a time.
 *
 *   identity    who is signing in and which organisation they belong to: the sign-in, session, two-step and membership lookups that
 *               have to run before an organisation is known (or that resolve it).
 *   bootstrap   creating an organisation and its reference data, and its lifecycle (suspend, delete).
 *   platform    the platform console, which acts across organisations by design, and the health probe.
 *   cron-claim  background jobs and sweeps that must see every organisation to find work, and claim it.
 *
 * The rule is by FILE and is deliberately narrow: a file is only allowed when all of its tenant-data use is of that kind. A file that
 * mixes a legitimate lookup with business-record access is `tenant-data` (conservative): UC-F5 splits it. Edit a category in
 * `config/adminDbAllowList.json` (it is kept on regeneration) when a human has reviewed that file and decided otherwise.
 */
export const ALLOWED_CATEGORIES = ["identity", "bootstrap", "platform", "cron-claim"] as const;
export type AllowedCategory = (typeof ALLOWED_CATEGORIES)[number];
export type Category = AllowedCategory | "tenant-data";
export const ALL_CATEGORIES: readonly Category[] = [...ALLOWED_CATEGORIES, "tenant-data"];

interface Rule {
  test: RegExp;
  category: Category;
  note?: string;
}

const RULES: Rule[] = [
  // identity
  { test: /^src\/auth\//, category: "identity" },
  { test: /^src\/services\/(authService|authAudit|sessionService|twoStepService|signInEventService|membershipService|meContextService|accessStateService|organizationSwitcherService)\.ts$/, category: "identity" },
  { test: /^src\/repositories\/memberships\.ts$/, category: "identity", note: "Hand-checked and fine in the audit (S-1)." },
  { test: /^src\/repositories\/(organizations|roles)\.ts$/, category: "identity" },
  // bootstrap
  { test: /^src\/services\/(organizationDefaults|organizationProvisioningService|organizationLifecycleService|referenceDataService)\.ts$/, category: "bootstrap" },
  // platform
  { test: /^src\/services\/platform[A-Za-z]*Service\.ts$/, category: "platform" },
  { test: /^src\/services\/platformFlagsService\.ts$/, category: "platform" },
  { test: /^src\/services\/supportAccessService\.ts$/, category: "platform", note: "Hand-checked and fine in the audit (S-1)." },
  { test: /^src\/app\/api\/health\/route\.ts$/, category: "platform", note: "Health probe: `SELECT 1` only." },
  // cron-claim
  { test: /^src\/jobs\//, category: "cron-claim" },
  { test: /^src\/repositories\/(backgroundJobs|scheduledJobRuns)\.ts$/, category: "cron-claim" },
  { test: /^src\/observability\/jobQueue\.ts$/, category: "cron-claim" },
  { test: /^src\/services\/notificationSweepService\.ts$/, category: "cron-claim" },
];

/** The first-pass category of a file (path only). Everything not matched is `tenant-data`. */
export function defaultCategory(file: string): { category: Category; note?: string } {
  for (const rule of RULES) if (rule.test.test(file)) return { category: rule.category, ...(rule.note ? { note: rule.note } : {}) };
  return { category: "tenant-data" };
}

/** Files that hold the owner client itself: its own references are not uses. */
export const SCAN_EXCLUDED_FILES = new Set(["src/db/adminClient.ts"]);
