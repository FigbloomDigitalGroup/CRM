/**
 * The one place that builds a link to Settings (FIG-1586). Settings picks its section from `?tab=<id>`; a link without a valid id lands
 * on Organization profile, so every call to action that points at a setting goes through `settingsHref` / `settingsPath` and the
 * section id is a union: a wrong or missing id fails the typecheck. No React or server imports, so pages, services and tests can all use it.
 * Settings is Management only: show these links only to people who hold `configuration.manage`.
 */

export const SETTINGS_TAB_IDS = [
  "org",
  "members",
  "website",
  "email",
  "ref",
  "lifecycle",
  "template",
  "automations",
  "integrations",
  "templates",
  "tags",
  "fields",
  "migration",
  "security",
  "privacy",
  "audit",
  "connect",
  "ai",
  "twofa",
  "datareq",
  "catalogue",
  "pipelines",
  "sequences",
  "webforms",
  "approvalrules",
  "quotetax",
  "invoicenumbering",
] as const;

export type SettingsTabId = (typeof SETTINGS_TAB_IDS)[number];

/** The Settings page itself, with no section chosen (it opens Organization profile). Used by menus and the palette, not by call to actions. */
export const SETTINGS_ROOT = "/settings";

export function isSettingsTabId(value: string | null | undefined): value is SettingsTabId {
  return !!value && (SETTINGS_TAB_IDS as readonly string[]).includes(value);
}

/** Path below the organisation, such as `/settings?tab=members`. Extra query parameters are appended after the tab. */
export function settingsPath(tab: SettingsTabId, extra?: Record<string, string>): string {
  const query = new URLSearchParams({ tab, ...extra });
  return `${SETTINGS_ROOT}?${query.toString()}`;
}

/** Full in-app link, such as `/o/acme/settings?tab=members`. */
export function settingsHref(orgSlug: string, tab: SettingsTabId, extra?: Record<string, string>): string {
  return `/o/${orgSlug}${settingsPath(tab, extra)}`;
}
