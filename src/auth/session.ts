import { randomBytes, createHash } from "node:crypto";
import type { Session } from "@prisma/client";
import { adminDb } from "../db/adminClient";
import { describeDevice, type ClientInfo } from "./deviceInfo";
import {
  EXPIRY_WARNING_SECONDS,
  getSessionLifetimeHours,
  HOUR_MS,
  MAX_ABSOLUTE_SESSION_HOURS,
} from "./sessionPolicy";

/**
 * Real, revocable, server-tracked sessions (FIG-592, B1.04) -- the production
 * replacement for src/auth/devSession.ts's stateless signed cookie.
 *
 * Same generate-random/hash-and-compare pattern as WebsiteApiKey
 * (src/auth/websiteApiKey.ts): the token is high-entropy (32 random bytes),
 * so a fast hash (SHA-256) is the right tool, and only the hash is ever
 * persisted. Being DB-backed (rather than a signed JWT) is what makes
 * "sessions ... can be revoked" possible -- revocation just has to update a
 * row, and the device is signed out on its very next request.
 *
 * Lifetime: a session lasts the organisation's policy (4/8/12/24 hours,
 * default 8) from sign-in. "Stay signed in" pushes it out by one policy
 * period, never past `absoluteExpiresAt`.
 */

const COOKIE_NAME = "figbloom_session";

export type RevokedReason =
  | "SIGNED_OUT"
  | "REVOKED"
  | "SIGNED_OUT_OTHERS"
  | "DEACTIVATED"
  | "REMOVED"
  | "PASSWORD_RESET"
  | "LOCKED";

export function hashSessionToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

function generateToken(): { plaintext: string; tokenHash: string } {
  const plaintext = randomBytes(32).toString("base64url");
  return { plaintext, tokenHash: hashSessionToken(plaintext) };
}

/** The organisation a session is signed in under: the user's oldest active membership, if any. */
export async function primaryOrganizationId(userId: string): Promise<string | null> {
  const membership = await adminDb.membership.findFirst({
    where: { userId, status: "ACTIVE" },
    orderBy: [{ joinedAt: "asc" }, { createdAt: "asc" }],
    select: { organizationId: true },
  });
  return membership?.organizationId ?? null;
}

export interface CreateSessionOptions {
  client?: Partial<ClientInfo>;
  /** Override the organisation (defaults to the user's primary one). */
  organizationId?: string | null;
}

export interface CreatedSession {
  token: string;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  sessionId: string;
  organizationId: string | null;
  deviceLabel: string;
  /** True when this user has signed in before but never from this device. */
  isNewDevice: boolean;
}

export async function createSession(
  userId: string,
  input?: string | null | CreateSessionOptions,
): Promise<CreatedSession> {
  const options: CreateSessionOptions =
    typeof input === "string" || input === null || input === undefined
      ? { client: { userAgent: input ?? null } }
      : input;
  const client = options.client ?? {};
  const organizationId =
    options.organizationId !== undefined
      ? options.organizationId
      : await primaryOrganizationId(userId);

  const { plaintext, tokenHash } = generateToken();
  const now = Date.now();
  const lifetimeHours = await getSessionLifetimeHours(organizationId);
  const absoluteExpiresAt = new Date(now + MAX_ABSOLUTE_SESSION_HOURS * HOUR_MS);
  const expiresAt = new Date(
    Math.min(now + lifetimeHours * HOUR_MS, absoluteExpiresAt.getTime()),
  );
  const deviceLabel = describeDevice(client.userAgent);

  const [earlier, sameDevice] = await Promise.all([
    adminDb.session.count({ where: { userId } }),
    adminDb.session.count({ where: { userId, deviceLabel } }),
  ]);

  const created = await adminDb.session.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
      absoluteExpiresAt,
      createdAt: new Date(now),
      lastSeenAt: new Date(now),
      userAgent: client.userAgent ?? undefined,
      ipAddress: client.ipAddress ?? undefined,
      place: client.place ?? undefined,
      deviceLabel,
      organizationId,
    },
  });

  return {
    token: plaintext,
    expiresAt,
    absoluteExpiresAt,
    sessionId: created.id,
    organizationId,
    deviceLabel,
    isNewDevice: earlier > 0 && sameDevice === 0,
  };
}

export type SessionLookup =
  | { state: "active"; session: Session; userId: string }
  | { state: "expired" | "revoked"; email: string | null }
  | { state: "unknown" };

/**
 * Resolves a session cookie. Anything expired, revoked, or belonging to a
 * user whose account is no longer active comes back as `expired` / `revoked`
 * with the account's email (so the UI can show the session-ended screen with
 * the email filled in) rather than as nothing. Touches `lastSeenAt` on every
 * active resolution without extending `expiresAt` -- only "Stay signed in"
 * does that.
 */
export async function lookupSession(
  token: string | undefined | null,
): Promise<SessionLookup> {
  if (!token) return { state: "unknown" };

  const session = await adminDb.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: { select: { email: true, status: true } } },
  });
  if (!session) return { state: "unknown" };

  const { user, ...row } = session;
  if (row.revokedAt || user.status !== "ACTIVE") {
    return { state: "revoked", email: user.email };
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    return { state: "expired", email: user.email };
  }

  await adminDb.session.update({
    where: { id: row.id },
    data: { lastSeenAt: new Date() },
  });
  return { state: "active", session: row, userId: row.userId };
}

/** Resolves a session cookie to its user id, or null for anything that is not an active session. */
export async function resolveSessionUserId(
  token: string | undefined | null,
): Promise<string | null> {
  const found = await lookupSession(token);
  return found.state === "active" ? found.userId : null;
}

export async function revokeSession(
  token: string,
  reason: RevokedReason = "SIGNED_OUT",
): Promise<void> {
  await adminDb.session.updateMany({
    where: { tokenHash: hashSessionToken(token), revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}

/** Revokes every live session of a user, optionally only those signed in under one organisation, optionally sparing one. */
export async function revokeSessionsForUser(
  userId: string,
  options: {
    reason: RevokedReason;
    organizationId?: string;
    exceptSessionId?: string;
  },
): Promise<number> {
  const result = await adminDb.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(options.organizationId ? { organizationId: options.organizationId } : {}),
      ...(options.exceptSessionId ? { id: { not: options.exceptSessionId } } : {}),
    },
    data: { revokedAt: new Date(), revokedReason: options.reason },
  });
  return result.count;
}

/** Used by password reset -- a new password should kill every other session. */
export async function revokeAllSessionsForUser(
  userId: string,
  reason: RevokedReason = "PASSWORD_RESET",
): Promise<void> {
  await revokeSessionsForUser(userId, { reason });
}

export interface SessionSummary {
  id: string;
  signedInAt: string;
  lastActiveAt: string;
  expiresAt: string;
  absoluteExpiresAt: string;
  /** Whole seconds until it ends (never negative). */
  secondsLeft: number;
  /** When the expiry warning should appear: five minutes before `expiresAt`. */
  warnAt: string;
  /** Seconds from now until the warning (0 once it is due). */
  warnInSeconds: number;
  /** True once the warning is due. */
  warn: boolean;
  /** The organisation's chosen lifetime. */
  lifetimeHours: number;
  /** False once the absolute ceiling has been reached: "Stay signed in" can no longer help. */
  canExtend: boolean;
  deviceLabel: string | null;
  ipAddress: string | null;
  place: string | null;
  current: boolean;
}

export function summariseSession(
  session: Session,
  lifetimeHours: number,
  currentSessionId: string | null,
  now: number = Date.now(),
): SessionSummary {
  const expires = session.expiresAt.getTime();
  const warnAtMs = expires - EXPIRY_WARNING_SECONDS * 1000;
  const secondsLeft = Math.max(0, Math.floor((expires - now) / 1000));
  return {
    id: session.id,
    signedInAt: session.createdAt.toISOString(),
    lastActiveAt: session.lastSeenAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
    secondsLeft,
    warnAt: new Date(warnAtMs).toISOString(),
    warnInSeconds: Math.max(0, Math.ceil((warnAtMs - now) / 1000)),
    warn: now >= warnAtMs,
    lifetimeHours,
    canExtend: expires < session.absoluteExpiresAt.getTime(),
    deviceLabel: session.deviceLabel,
    ipAddress: session.ipAddress,
    place: session.place,
    current: session.id === currentSessionId,
  };
}

export { COOKIE_NAME as SESSION_COOKIE_NAME };
