import { ValidationError } from "./errors";
import { adminDb } from "../db/adminClient";

/**
 * Session lifetime policy (B1.04). Management picks how long a session lasts
 * without the person choosing "Stay signed in": 4, 8, 12 or 24 hours, 8 by
 * default. Stored as one `OrganizationSetting` row (`session.lifetime_hours`).
 *
 * "Stay signed in" (`POST /api/session/extend`) pushes `expiresAt` out by one
 * policy period from now, never past the session's absolute ceiling
 * (`MAX_ABSOLUTE_SESSION_HOURS` after sign-in), so a session cannot be kept
 * alive forever by clicking the button.
 */
export const SESSION_LIFETIME_KEY = "session.lifetime_hours";
export const SESSION_LIFETIME_OPTIONS = [4, 8, 12, 24] as const;
export type SessionLifetimeHours = (typeof SESSION_LIFETIME_OPTIONS)[number];
export const DEFAULT_SESSION_LIFETIME_HOURS: SessionLifetimeHours = 8;
/** However often it is extended, a session ends this long after sign-in. */
export const MAX_ABSOLUTE_SESSION_HOURS = 7 * 24;
/** The expiry warning appears this long before the session ends. */
export const EXPIRY_WARNING_SECONDS = 5 * 60;

export const HOUR_MS = 60 * 60 * 1000;

function isOption(value: unknown): value is SessionLifetimeHours {
  return SESSION_LIFETIME_OPTIONS.some((o) => o === value);
}

/** The organisation's lifetime in hours; the default when it has not chosen (or has no organisation yet). */
export async function getSessionLifetimeHours(
  organizationId: string | null | undefined,
): Promise<SessionLifetimeHours> {
  if (!organizationId) return DEFAULT_SESSION_LIFETIME_HOURS;
  const row = await adminDb.organizationSetting.findUnique({
    where: { organizationId_key: { organizationId, key: SESSION_LIFETIME_KEY } },
  });
  return isOption(row?.value) ? row.value : DEFAULT_SESSION_LIFETIME_HOURS;
}

export async function setSessionLifetimeHours(
  organizationId: string,
  hours: number,
): Promise<SessionLifetimeHours> {
  if (!isOption(hours)) {
    throw new ValidationError(
      `Session lifetime must be one of ${SESSION_LIFETIME_OPTIONS.join(", ")} hours.`,
      [{ path: "lifetimeHours", message: `Choose ${SESSION_LIFETIME_OPTIONS.join(", ")}.` }],
    );
  }
  await adminDb.organizationSetting.upsert({
    where: { organizationId_key: { organizationId, key: SESSION_LIFETIME_KEY } },
    create: { organizationId, key: SESSION_LIFETIME_KEY, value: hours },
    update: { value: hours },
  });
  return hours;
}
