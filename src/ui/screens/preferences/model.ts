/**
 * The shapes Preferences reads. The frozen contract types several of these answers loosely (`{}`), so the screen states what it relies on
 * here, in one place; the field names are the ones `GET /me/preferences`, `/me/profile`, `/me/notification-preferences`, `/me/sessions`
 * and `/me/sign-in-events` return (B1.04, B1.06, B1.08, B1.09, B1.11).
 */

export type TabId = "profile" | "notifications" | "appearance" | "security";
export const TAB_IDS: readonly TabId[] = ["profile", "notifications", "appearance", "security"];

export function parseTab(value: string | null | undefined): TabId {
  return (TAB_IDS as readonly string[]).includes(value ?? "") ? (value as TabId) : "appearance";
}

export interface EffectiveLookView {
  source: "own" | "organisation";
  locked: boolean;
  theme: string;
  pageColour: string;
  toggle: { light: string; dark: string };
  colours: { sidebar: string; accent: string; highlight: string; page: { key: string; label?: string; hex: string | null; dark: boolean } };
}

export interface PreferencesView {
  appearance: {
    theme: string | null;
    pageColour: string | null;
    density: string;
    effective: EffectiveLookView;
    organisationDefault: { theme: string; pageColour: string };
  };
  personalisation: { allowed: boolean; locked: boolean; ownColoursAvailable: boolean };
  startPage: { key: string | null; unavailable: boolean; options: { key: string; label: string; path: string }[] };
  sidebar: { collapsed: boolean; hidden: string[] };
  regional: { hourFormat: string; firstDayOfWeek: string; dateFormat: string };
  undoAvailable: boolean;
  ignored?: string[];
}

export interface ProfileView {
  name: string;
  email: string;
  phone: string | null;
  timeZone: string | null;
  organizationTimeZone: string;
  effectiveTimeZone: string;
  avatar: { url: string | null; initials: string; updatedAt: string | null; crop: { x: number; y: number; size: number } | null };
}

export interface NotificationType {
  type: string;
  label: string;
  description: string;
  important: boolean;
  alwaysOn: boolean;
  channels: {
    inApp: { enabled: boolean; locked: boolean };
    email: { enabled: boolean; locked: boolean };
    push: { enabled: boolean; available: boolean; note: string };
  };
}

export interface NotificationPrefsView {
  preset: "EVERYTHING" | "IMPORTANT_ONLY" | "OFF" | "CUSTOM";
  presets: { key: string; label: string; description: string }[];
  types: NotificationType[];
  quietHours: { enabled: boolean; start: string; end: string; timeZone: string };
  dailyEmailCap: number;
  dailyEmailCapRange: { min: number; max: number; default: number };
  heldForDigest: number;
}

export interface SessionRow {
  id: string;
  signedInAt: string;
  lastActiveAt: string;
  deviceLabel: string | null;
  place: string | null;
  current: boolean;
}

export interface SignInEventRow {
  id: string;
  outcome: "SUCCESS" | "FAILURE" | "LOCKOUT" | "NEW_DEVICE";
  reason: string | null;
  deviceLabel: string | null;
  place: string | null;
  createdAt: string;
}

/** Image rules the picture upload enforces before it asks the API (the API checks again: 2 MB, JPG or PNG, at least 128 px). */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_TYPES = ["image/jpeg", "image/png"] as const;
export const AVATAR_MIN_PX = 128;

export function refuseAvatar(file: { type: string; size: number }): string | null {
  if (!(AVATAR_TYPES as readonly string[]).includes(file.type)) return "Only JPG or PNG pictures work.";
  if (file.size > AVATAR_MAX_BYTES) return "That picture is over 2 MB. Choose a smaller one.";
  return null;
}

/** The device row for a session or sign-in: "Chrome on Windows" and where, with the icon the design draws. */
export function deviceIcon(label: string | null): "phone" | "desktop" {
  return /iphone|android|ipad|mobile|app/i.test(label ?? "") ? "phone" : "desktop";
}

export const OUTCOME_LABEL: Record<SignInEventRow["outcome"], { text: string; tone: "ok" | "warn" | "bad" }> = {
  SUCCESS: { text: "Signed in", tone: "ok" },
  FAILURE: { text: "Wrong password", tone: "warn" },
  LOCKOUT: { text: "Blocked (too many attempts)", tone: "bad" },
  NEW_DEVICE: { text: "Signed in on a new device", tone: "ok" },
};
