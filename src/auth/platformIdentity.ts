import { adminDb } from "../db/adminClient";
import { devAccountsAllowed } from "./devAccounts";
import {
  DEV_PLATFORM_COOKIE_NAME,
  verifyPlatformCookieValue,
} from "./devSession";
import type { CookieReader } from "./requestContext";

/**
 * Platform identities (FIG-1196, B0.09): the sign-in for a Platform Super
 * Admin, kept apart from tenant users. Today only the dev-only fixture
 * exists; B6.03 adopts this module for real platform admins.
 *
 * A platform identity has no organization, no membership and no permission
 * keys, and nothing here produces an `AuthContext`, so it can never be used
 * on a tenant endpoint.
 */
export async function findDevPlatformIdentityByEmail(email: string) {
  return adminDb.platformIdentity.findFirst({
    where: { email, isDev: true },
  });
}

/**
 * The dev Super Admin behind this request's cookie, or null. Returns null
 * unless dev accounts are allowed (development + ALLOW_DEV_ACCOUNTS=true), so
 * outside local development a leftover cookie is never honored.
 */
export async function resolveDevPlatformIdentity(
  cookieStore: CookieReader,
  env: Record<string, string | undefined> = process.env,
) {
  if (!devAccountsAllowed(env)) return null;
  const id = verifyPlatformCookieValue(
    cookieStore.get(DEV_PLATFORM_COOKIE_NAME)?.value,
  );
  if (!id) return null;
  return adminDb.platformIdentity.findFirst({ where: { id, isDev: true } });
}

/**
 * Audit entry for every dev Super Admin sign-in. Platform-level, so it has no
 * organization (audit_events.organization_id is nullable for exactly this).
 */
export async function recordDevPlatformSignIn(identity: {
  id: string;
  email: string;
}) {
  await adminDb.auditEvent.create({
    data: {
      action: "platform.dev_signin",
      entityType: "PlatformIdentity",
      entityId: identity.id,
      metadata: { email: identity.email, dev: true },
    },
  });
}
