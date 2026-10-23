import { ValidationError } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import { DEVICE_ONLY_DEFAULTS, TEXT_SIZES } from "./preferenceService";

/**
 * The Platform Super Admin's preferences (FIG-1024, B1.08): light or dark for
 * the console, and the device-only accessibility settings. A platform identity
 * belongs to no organisation, so the themes, page colours, start pages and
 * regional choices of a member are not offered, and asking for them says why.
 */
export const PLATFORM_UI_MODES = ["LIGHT", "DARK"] as const;
export type PlatformUiMode = (typeof PLATFORM_UI_MODES)[number];

const ALLOWED = new Set(["uiMode", ...Object.keys(DEVICE_ONLY_DEFAULTS)]);

export async function getPlatformPreferences(identityId: string) {
  const identity = await adminDb.platformIdentity.findUniqueOrThrow({ where: { id: identityId } });
  return {
    uiMode: identity.uiMode as PlatformUiMode,
    uiModes: [...PLATFORM_UI_MODES],
    deviceOnly: { ...DEVICE_ONLY_DEFAULTS, storedOn: "device" as const, textSizes: [...TEXT_SIZES] },
    note: "The platform console supports light or dark and the accessibility settings only.",
  };
}

export async function updatePlatformPreferences(identityId: string, input: Record<string, unknown>) {
  const issues: { path: string; message: string; code?: string }[] = [];
  for (const key of Object.keys(input)) {
    if (key in DEVICE_ONLY_DEFAULTS) {
      issues.push({
        path: key,
        code: "DEVICE_ONLY_SETTING",
        message: "Accessibility settings are saved on this device, not on the account, so they cannot be changed here.",
      });
    } else if (!ALLOWED.has(key)) {
      issues.push({
        path: key,
        code: "PLATFORM_PREFERENCE_NOT_AVAILABLE",
        message: `"${key}" is not available to the Platform Super Admin. The console supports light or dark and the accessibility settings only.`,
      });
    }
  }
  if (input.uiMode !== undefined && !(PLATFORM_UI_MODES as readonly unknown[]).includes(input.uiMode)) {
    issues.push({ path: "uiMode", message: `The console mode must be one of: ${PLATFORM_UI_MODES.join(", ")}.` });
  }
  if (issues.length > 0) {
    throw new ValidationError(issues.length === 1 ? issues[0]!.message : "Some preferences are not available.", issues);
  }
  if (input.uiMode !== undefined) {
    await adminDb.platformIdentity.update({ where: { id: identityId }, data: { uiMode: input.uiMode as PlatformUiMode } });
    await adminDb.auditEvent.create({
      data: {
        action: "platform.preferences_updated",
        entityType: "PlatformIdentity",
        entityId: identityId,
        newValue: { uiMode: input.uiMode as string },
      },
    });
  }
  return getPlatformPreferences(identityId);
}
