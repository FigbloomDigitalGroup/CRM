import type { Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { ValidationError, type ValidationIssue } from "../auth/errors";
import { withOrgContext } from "../db/orgScopedClient";
import { loadFeatureConfig } from "../lib/featureConfig";
import {
  EMAIL_CAP_DEFAULT,
  EMAIL_CAP_MAX,
  EMAIL_CAP_MIN,
  NOTIFICATION_TYPES,
  PRESETS,
  findTypeDef,
  presetValue,
  relevantTypes,
  type NotificationTypeDef,
  type NotificationTypeKey,
  type PresetKey,
} from "../notifications/catalogue";
import { isValidClock, startOfLocalDay } from "../notifications/timeZone";
import { recordAuditEvent } from "../repositories/auditEvents";
import { countEmailsSentSince } from "../repositories/notificationDeliveries";
import { resolveEffectivePreferences, upsertPreference } from "../repositories/notificationPreferences";
import { getNotificationSettings, saveNotificationSettings } from "../repositories/notificationSettings";
import { pushConfigured } from "../notifications/webPush";
import { pushPreferenceMap } from "../repositories/pushSubscriptions";
import { memberTimeZone } from "./notificationDeliveryPolicy";
import { hasPushDevice } from "./pushService";

/**
 * Notification preferences v2 (FIG-1027, B1.11): per-role types, three channels
 * (in-app, email, push), presets, quiet hours and a daily email cap. The older
 * single-type endpoint keeps working for the types it knew.
 *
 * Push is stored and shown but unavailable: it arrives with the mobile app, so
 * turning it on is refused with that reason rather than silently accepted.
 * Overdue task alerts are always on in both channels.
 */

export const PUSH_UNAVAILABLE_NOTE = "Push notifications arrive with the mobile app.";

export interface UpdateNotificationPreferencesInput {
  preset?: string;
  types?: Record<string, { inApp?: boolean; email?: boolean; push?: boolean }>;
  quietHours?: { enabled?: boolean; start?: string; end?: string };
  dailyEmailCap?: number;
}

function detectPreset(
  defs: NotificationTypeDef[],
  effective: Record<NotificationTypeKey, { emailEnabled: boolean; inAppEnabled: boolean }>,
): PresetKey | "CUSTOM" {
  for (const p of PRESETS) {
    const matches = defs.every((d) => {
      const want = presetValue(p.key, d);
      const have = effective[d.key];
      return have.emailEnabled === want && have.inAppEnabled === want;
    });
    if (matches) return p.key;
  }
  return "CUSTOM";
}

/** Why push cannot be turned on for this person right now, or null when it can (B4.07). */
async function pushBlocker(ctx: AuthContext): Promise<string | null> {
  if (!pushConfigured()) return PUSH_UNAVAILABLE_NOTE;
  if (!(await hasPushDevice(ctx))) return "Allow notifications on this phone or browser first, so there is a device to send to.";
  return null;
}

export async function getMyNotificationPreferencesV2(ctx: AuthContext) {
  const config = await loadFeatureConfig(ctx.organizationId);
  const defs = relevantTypes(ctx, config.release);
  const [effective, settings, timeZone, blocker, pushPrefs] = await Promise.all([
    resolveEffectivePreferences(ctx.organizationId, ctx.membershipId),
    getNotificationSettings(ctx.organizationId, ctx.membershipId),
    memberTimeZone(ctx.organizationId, ctx.membershipId),
    pushBlocker(ctx),
    pushPreferenceMap(ctx.organizationId, ctx.membershipId),
  ]);
  const [emailsToday, held] = await Promise.all([
    countEmailsSentSince(ctx.organizationId, ctx.membershipId, startOfLocalDay(new Date(), timeZone)),
    withOrgContext(ctx.organizationId, (tx) =>
      tx.notificationDelivery.count({
        where: {
          organizationId: ctx.organizationId,
          digestPending: true,
          status: { in: ["PENDING", "FAILED"] },
          notification: { membershipId: ctx.membershipId },
        },
      }),
    ),
  ]);

  return {
    preset: detectPreset(defs, effective),
    presets: PRESETS.map((p) => ({ ...p })),
    types: defs.map((d) => ({
      type: d.key,
      label: d.label,
      description: d.description,
      important: d.important,
      alwaysOn: d.alwaysOn,
      channels: {
        inApp: { enabled: effective[d.key].inAppEnabled, locked: d.alwaysOn },
        email: { enabled: effective[d.key].emailEnabled, locked: d.alwaysOn },
        push: { enabled: blocker === null && pushPrefs.get(d.key) === true, available: blocker === null, note: blocker ?? "Notifications are sent to your registered phones and browsers." },
      },
    })),
    quietHours: { ...settings.quietHours, timeZone },
    dailyEmailCap: settings.dailyEmailCap,
    dailyEmailCapRange: { min: EMAIL_CAP_MIN, max: EMAIL_CAP_MAX, default: EMAIL_CAP_DEFAULT },
    emailsToday,
    heldForDigest: held,
  };
}

export type NotificationPreferencesView = Awaited<ReturnType<typeof getMyNotificationPreferencesV2>>;

export async function updateMyNotificationPreferencesV2(
  ctx: AuthContext,
  input: UpdateNotificationPreferencesInput,
): Promise<NotificationPreferencesView> {
  const config = await loadFeatureConfig(ctx.organizationId);
  const defs = relevantTypes(ctx, config.release);
  const relevant = new Set<string>(defs.map((d) => d.key));
  const issues: ValidationIssue[] = [];

  // ---- preset
  let preset: PresetKey | undefined;
  if (input.preset !== undefined) {
    if (PRESETS.some((p) => p.key === input.preset)) preset = input.preset as PresetKey;
    else {
      issues.push({ path: "preset", message: `"${input.preset}" is not a preset. Choose one of: ${PRESETS.map((p) => p.key).join(", ")}.` });
    }
  }

  // ---- per type
  let pushBlockerMessage: string | undefined;
  const writes = new Map<NotificationTypeKey, { emailEnabled?: boolean; inAppEnabled?: boolean; pushEnabled?: boolean }>();
  for (const [type, change] of Object.entries(input.types ?? {})) {
    const def = findTypeDef(type);
    if (!def || !(NOTIFICATION_TYPES as readonly string[]).includes(type)) {
      issues.push({ path: `types.${type}`, message: `"${type}" is not a notification type.` });
      continue;
    }
    if (!relevant.has(type)) {
      issues.push({
        path: `types.${type}`,
        code: "NOTIFICATION_NOT_FOR_ROLE",
        message: `"${def.label}" does not apply to your role, so there is nothing to set.`,
      });
      continue;
    }
    if (change.push === true) {
      pushBlockerMessage ??= (await pushBlocker(ctx)) ?? "";
      if (pushBlockerMessage) {
        issues.push({ path: `types.${type}.push`, code: "PUSH_NOT_AVAILABLE", message: `${pushBlockerMessage} It cannot be turned on yet.` });
      }
    }
    if (def.alwaysOn && (change.inApp === false || change.email === false)) {
      issues.push({
        path: `types.${type}`,
        code: "NOTIFICATION_ALWAYS_ON",
        message: "Overdue task alerts cannot be turned off, so a missed deadline is never hidden from you.",
      });
      continue;
    }
    const w: { emailEnabled?: boolean; inAppEnabled?: boolean; pushEnabled?: boolean } = {};
    if (change.email !== undefined) w.emailEnabled = change.email;
    if (change.inApp !== undefined) w.inAppEnabled = change.inApp;
    if (change.push !== undefined) w.pushEnabled = change.push;
    if (Object.keys(w).length > 0) writes.set(def.key, w);
  }

  // ---- quiet hours and cap
  const current = await getNotificationSettings(ctx.organizationId, ctx.membershipId);
  const next = { quietHours: { ...current.quietHours }, dailyEmailCap: current.dailyEmailCap };
  if (input.quietHours) {
    const q = input.quietHours;
    if (q.enabled !== undefined) next.quietHours.enabled = q.enabled;
    for (const f of ["start", "end"] as const) {
      const v = q[f];
      if (v === undefined) continue;
      if (typeof v !== "string" || !isValidClock(v)) {
        issues.push({ path: `quietHours.${f}`, message: "Use a 24-hour time such as 20:00 or 07:30." });
      } else next.quietHours[f] = v;
    }
    if (issues.every((i) => !i.path.startsWith("quietHours")) && next.quietHours.start === next.quietHours.end) {
      issues.push({ path: "quietHours", message: "Quiet hours cannot start and end at the same time." });
    }
  }
  if (input.dailyEmailCap !== undefined) {
    const cap = input.dailyEmailCap;
    if (!Number.isInteger(cap) || cap < EMAIL_CAP_MIN || cap > EMAIL_CAP_MAX) {
      issues.push({ path: "dailyEmailCap", message: `The daily email limit must be a whole number from ${EMAIL_CAP_MIN} to ${EMAIL_CAP_MAX}.` });
    } else next.dailyEmailCap = cap;
  }

  if (issues.length > 0) {
    throw new ValidationError(issues.length === 1 ? issues[0]!.message : "Some notification preferences are not valid.", issues);
  }

  // ---- apply: the preset first, then the individual choices on top of it
  const applied: Record<string, { email: boolean; inApp: boolean }> = {};
  if (preset) {
    for (const def of defs) {
      const v = presetValue(preset, def);
      await upsertPreference(ctx.organizationId, ctx.membershipId, def.key, { emailEnabled: v, inAppEnabled: v });
      applied[def.key] = { email: v, inApp: v };
    }
  }
  for (const [type, w] of writes) {
    await upsertPreference(ctx.organizationId, ctx.membershipId, type, w);
    applied[type] = {
      email: w.emailEnabled ?? applied[type]?.email ?? true,
      inApp: w.inAppEnabled ?? applied[type]?.inApp ?? true,
    };
  }
  const settingsChanged =
    JSON.stringify(next) !== JSON.stringify({ quietHours: current.quietHours, dailyEmailCap: current.dailyEmailCap });
  if (settingsChanged) await saveNotificationSettings(ctx.organizationId, ctx.membershipId, next);

  if (preset || writes.size > 0 || settingsChanged) {
    await recordAuditEvent({
      organizationId: ctx.organizationId,
      actorMembershipId: ctx.membershipId,
      action: "notification_preferences.updated",
      entityType: "Membership",
      entityId: ctx.membershipId,
      newValue: {
        ...(preset ? { preset } : {}),
        ...(writes.size > 0 ? { types: Object.fromEntries(writes) } : {}),
        ...(settingsChanged ? { quietHours: next.quietHours, dailyEmailCap: next.dailyEmailCap } : {}),
      } as unknown as Prisma.InputJsonValue,
    });
  }
  return getMyNotificationPreferencesV2(ctx);
}
