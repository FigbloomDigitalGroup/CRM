import type { PrismaClient } from "@prisma/client";
import { ValidationError } from "./errors";
import { getPlatformDb } from "../db/platformClient";

/**
 * Platform security settings (FIG-1140, B6.08, design PL14). One row per
 * setting in `platform_settings`; every value is range-checked here, and the
 * defaults are the values B6.03 shipped, so an empty table changes nothing.
 * The minimum of two active platform admins is NOT a setting: it is a rule
 * (`MIN_ACTIVE_PLATFORM_ADMINS`) nobody can lower.
 */
export const MIN_ACTIVE_PLATFORM_ADMINS = 2;

export const PLATFORM_SETTING_DEFS = {
  idleHours: { key: "session.idle_hours", label: "Idle sign-out (hours)", min: 1, max: 8, default: 4 },
  absoluteHours: { key: "session.absolute_hours", label: "Longest session (hours)", min: 4, max: 24, default: 12 },
  reverifyMinutes: { key: "verification.window_minutes", label: "How long a verification counts (minutes)", min: 5, max: 60, default: 15 },
  maxFailedAttempts: { key: "lockout.max_failures", label: "Wrong attempts before a lock", min: 3, max: 10, default: 5 },
  lockoutMinutes: { key: "lockout.minutes", label: "Lock duration (minutes)", min: 5, max: 240, default: 15 },
} as const;

export type PlatformSettingName = keyof typeof PLATFORM_SETTING_DEFS;
export type PlatformSecuritySettings = Record<PlatformSettingName, number>;

export function defaultPlatformSettings(): PlatformSecuritySettings {
  return Object.fromEntries(Object.entries(PLATFORM_SETTING_DEFS).map(([name, def]) => [name, def.default])) as PlatformSecuritySettings;
}

export async function loadPlatformSettings(db: PrismaClient = getPlatformDb()): Promise<PlatformSecuritySettings> {
  const rows = await db.platformSetting.findMany();
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const out = defaultPlatformSettings();
  for (const [name, def] of Object.entries(PLATFORM_SETTING_DEFS) as [PlatformSettingName, (typeof PLATFORM_SETTING_DEFS)[PlatformSettingName]][]) {
    const value = byKey.get(def.key);
    if (typeof value === "number" && Number.isInteger(value) && value >= def.min && value <= def.max) out[name] = value;
  }
  // The idle limit can never exceed the absolute one.
  if (out.idleHours > out.absoluteHours) out.idleHours = out.absoluteHours;
  return out;
}

/** Validates a partial update; throws one ValidationError naming every bad field. */
export function validatePlatformSettingsPatch(patch: Partial<Record<PlatformSettingName, unknown>>, current: PlatformSecuritySettings): Partial<PlatformSecuritySettings> {
  const issues: { path: string; message: string }[] = [];
  const clean: Partial<PlatformSecuritySettings> = {};
  for (const [name, value] of Object.entries(patch)) {
    const def = PLATFORM_SETTING_DEFS[name as PlatformSettingName];
    if (!def) {
      issues.push({ path: name, message: "Unknown setting." });
      continue;
    }
    if (typeof value !== "number" || !Number.isInteger(value) || value < def.min || value > def.max) {
      issues.push({ path: name, message: `${def.label} must be a whole number from ${def.min} to ${def.max}.` });
      continue;
    }
    clean[name as PlatformSettingName] = value;
  }
  const merged = { ...current, ...clean };
  if (merged.idleHours > merged.absoluteHours) issues.push({ path: "idleHours", message: "Idle sign-out cannot be longer than the longest session." });
  if (issues.length > 0) throw new ValidationError(issues.length === 1 ? issues[0]!.message : "Validation failed.", issues);
  return clean;
}
