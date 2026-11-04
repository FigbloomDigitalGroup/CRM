import { createHash, randomBytes } from "node:crypto";
import { getPlatformDb } from "../db/platformClient";
import { ForbiddenError, UnauthorizedError } from "./errors";
import { devAccountsAllowed } from "./devAccounts";
import { resolveDevPlatformIdentity } from "./platformIdentity";
import { platformPermissionKeysFor, type PlatformPermissionKey } from "./platformPermissions";
import type { CookieReader } from "./requestContext";

/**
 * Platform sessions (FIG-1135, B6.03): the session type of a Platform Super
 * Admin, kept apart from tenant sessions (src/auth/session.ts). Own table
 * (`platform_sessions`), own cookie, own database role. A tenant session
 * token is never looked up here and a platform token is never looked up by the
 * tenant path, so neither identity can pass as the other.
 *
 * Same pattern as tenant sessions: a high-entropy random token, only its
 * SHA-256 stored, revocable by updating a row. Lifetime is shorter than a
 * tenant session (platform admins hold more power): 4 hours idle, 12 hours
 * absolute.
 */
export const PLATFORM_SESSION_COOKIE_NAME = "figbloom_platform_session";
export const PLATFORM_IDLE_HOURS = 4;
export const PLATFORM_ABSOLUTE_HOURS = 12;
const HOUR_MS = 60 * 60 * 1000;

export type PlatformRevokedReason = "SIGNED_OUT" | "REVOKED" | "SUSPENDED";

export function hashPlatformToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export interface PlatformSessionClient {
  userAgent?: string | null;
  ipAddress?: string | null;
}

export async function createPlatformSession(
  platformIdentityId: string,
  client: PlatformSessionClient = {},
): Promise<{ token: string; sessionId: string; expiresAt: Date; absoluteExpiresAt: Date }> {
  const db = getPlatformDb();
  const identity = await db.platformIdentity.findUnique({ where: { id: platformIdentityId } });
  if (!identity || identity.status !== "ACTIVE") {
    throw new UnauthorizedError("This platform account cannot sign in.");
  }

  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const absoluteExpiresAt = new Date(now + PLATFORM_ABSOLUTE_HOURS * HOUR_MS);
  const expiresAt = new Date(Math.min(now + PLATFORM_IDLE_HOURS * HOUR_MS, absoluteExpiresAt.getTime()));

  const row = await db.platformSession.create({
    data: {
      platformIdentityId,
      tokenHash: hashPlatformToken(token),
      expiresAt,
      absoluteExpiresAt,
      userAgent: client.userAgent ?? undefined,
      ipAddress: client.ipAddress ?? undefined,
    },
  });
  await db.platformIdentity.update({ where: { id: platformIdentityId }, data: { lastSignInAt: new Date(now) } });
  return { token, sessionId: row.id, expiresAt, absoluteExpiresAt };
}

export type PlatformSessionLookup =
  | { state: "active"; sessionId: string; identity: { id: string; email: string; name: string; status: string } }
  | { state: "expired" | "revoked" | "unknown" };

/** Resolves a platform session token. Anything not active gives no identity. Touches `lastSeenAt` and slides the idle expiry, never past the absolute limit. */
export async function lookupPlatformSession(token: string | undefined | null): Promise<PlatformSessionLookup> {
  if (!token) return { state: "unknown" };
  const db = getPlatformDb();
  const session = await db.platformSession.findUnique({
    where: { tokenHash: hashPlatformToken(token) },
    include: { identity: { select: { id: true, email: true, name: true, status: true } } },
  });
  if (!session) return { state: "unknown" };

  const now = Date.now();
  if (session.revokedAt || session.identity.status !== "ACTIVE") return { state: "revoked" };
  if (session.expiresAt.getTime() <= now || session.absoluteExpiresAt.getTime() <= now) return { state: "expired" };

  await db.platformSession.update({
    where: { id: session.id },
    data: {
      lastSeenAt: new Date(now),
      expiresAt: new Date(Math.min(now + PLATFORM_IDLE_HOURS * HOUR_MS, session.absoluteExpiresAt.getTime())),
    },
  });
  return { state: "active", sessionId: session.id, identity: session.identity };
}

export async function revokePlatformSession(token: string, reason: PlatformRevokedReason = "SIGNED_OUT"): Promise<void> {
  await getPlatformDb().platformSession.updateMany({
    where: { tokenHash: hashPlatformToken(token), revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}

/** Ends every live session of one platform identity (used when it is suspended). */
export async function revokePlatformSessionsFor(platformIdentityId: string, reason: PlatformRevokedReason): Promise<number> {
  const result = await getPlatformDb().platformSession.updateMany({
    where: { platformIdentityId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return result.count;
}

/** What a platform request carries. Deliberately has no organisation and no tenant permission keys. */
export interface PlatformContext {
  identityId: string;
  email: string;
  name: string;
  permissions: ReadonlySet<PlatformPermissionKey>;
  source: "session" | "dev";
}

/**
 * The one place a request becomes a platform identity: the platform session
 * cookie first; the dev Super Admin's cookie only when dev accounts are
 * allowed. Returns null for everyone else, a tenant user included (the
 * tenant session cookie is never read here), so callers answer 404.
 */
export async function resolvePlatformContext(
  cookieStore: CookieReader,
  env: Record<string, string | undefined> = process.env,
): Promise<PlatformContext | null> {
  const token = cookieStore.get(PLATFORM_SESSION_COOKIE_NAME)?.value;
  if (token) {
    const found = await lookupPlatformSession(token);
    if (found.state === "active") {
      return {
        identityId: found.identity.id,
        email: found.identity.email,
        name: found.identity.name,
        permissions: new Set(platformPermissionKeysFor(found.identity.status)),
        source: "session",
      };
    }
    return null;
  }

  if (devAccountsAllowed(env)) {
    const dev = await resolveDevPlatformIdentity(cookieStore, env);
    if (dev && dev.status === "ACTIVE") {
      return {
        identityId: dev.id,
        email: dev.email,
        name: dev.name,
        permissions: new Set(platformPermissionKeysFor(dev.status)),
        source: "dev",
      };
    }
  }
  return null;
}

/** Throws unless the context holds the key. */
export function requirePlatformPermission(context: PlatformContext, key: PlatformPermissionKey): void {
  if (!context.permissions.has(key)) throw new ForbiddenError(key);
}
