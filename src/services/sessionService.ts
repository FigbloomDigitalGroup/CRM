import { invalidateMeContext } from "./meContextCache";
import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { NotFoundError } from "../auth/errors";
import {
  revokeSessionsForUser,
  summariseSession,
  type SessionSummary,
} from "../auth/session";
import {
  getSessionLifetimeHours,
  HOUR_MS,
  MAX_ABSOLUTE_SESSION_HOURS,
  SESSION_LIFETIME_OPTIONS,
  setSessionLifetimeHours,
  EXPIRY_WARNING_SECONDS,
  DEFAULT_SESSION_LIFETIME_HOURS,
} from "../auth/sessionPolicy";
import { adminDb } from "../db/adminClient";
import { recordAuditEvent } from "../repositories/auditEvents";
import { recordAuthAuditEvent } from "./authAudit";

/**
 * "My sessions" (B1.04): the top bar's time-left, the Security tab's device
 * list, Stay signed in, and sign out other devices. These belong to the
 * person, not to an organisation, so they take a user id and the id of the
 * session making the request rather than an `AuthContext`.
 */

async function loadOwnLiveSession(userId: string, sessionId: string) {
  const session = await adminDb.session.findFirst({
    where: { id: sessionId, userId, revokedAt: null, expiresAt: { gt: new Date() } },
  });
  if (!session) throw new NotFoundError("Session", sessionId);
  return session;
}

/** The current session's time left and expiry-warning timing (TB2/TB3). */
export async function getSessionSummary(
  userId: string,
  sessionId: string,
): Promise<SessionSummary> {
  const session = await loadOwnLiveSession(userId, sessionId);
  const hours = await getSessionLifetimeHours(session.organizationId);
  return summariseSession(session, hours, sessionId);
}

/** Every live session the person has, current one first, then most recently active. */
export async function listMySessions(
  userId: string,
  currentSessionId: string | null,
): Promise<SessionSummary[]> {
  const sessions = await adminDb.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: "desc" },
  });
  const hoursByOrg = new Map<string | null, number>();
  const out: SessionSummary[] = [];
  for (const s of sessions) {
    if (!hoursByOrg.has(s.organizationId)) {
      hoursByOrg.set(s.organizationId, await getSessionLifetimeHours(s.organizationId));
    }
    out.push(summariseSession(s, hoursByOrg.get(s.organizationId)!, currentSessionId));
  }
  return out.sort((a, b) => Number(b.current) - Number(a.current));
}

/** Signs one of the person's own sessions out; that device is logged out on its next request. */
export async function revokeMySession(
  userId: string,
  sessionId: string,
  currentSessionId: string | null,
): Promise<{ revoked: true; wasCurrent: boolean }> {
  const session = await loadOwnLiveSession(userId, sessionId);
  await adminDb.session.update({
    where: { id: session.id },
    data: { revokedAt: new Date(), revokedReason: "REVOKED" },
  });
  await recordAuthAuditEvent(userId, "auth.session_revoked", {
    sessionId: session.id,
    device: session.deviceLabel,
  });
  return { revoked: true, wasCurrent: session.id === currentSessionId };
}

/** Signs out every session except the one making the request. */
export async function signOutOtherSessions(
  userId: string,
  currentSessionId: string,
): Promise<{ revokedCount: number }> {
  const revokedCount = await revokeSessionsForUser(userId, {
    reason: "SIGNED_OUT_OTHERS",
    exceptSessionId: currentSessionId,
  });
  if (revokedCount > 0) {
    await recordAuthAuditEvent(userId, "auth.other_sessions_revoked", { count: revokedCount });
  }
  return { revokedCount };
}

export interface ExtendResult {
  /** False when the session was already at its absolute ceiling and nothing changed. */
  extended: boolean;
  session: SessionSummary;
}

/**
 * "Stay signed in": pushes `expiresAt` out to one policy period from now,
 * but never beyond the session's absolute ceiling.
 */
export async function extendMySession(
  userId: string,
  sessionId: string,
): Promise<ExtendResult> {
  const session = await loadOwnLiveSession(userId, sessionId);
  const hours = await getSessionLifetimeHours(session.organizationId);
  const proposed = Math.min(
    Date.now() + hours * HOUR_MS,
    session.absoluteExpiresAt.getTime(),
  );
  if (proposed <= session.expiresAt.getTime()) {
    return { extended: false, session: summariseSession(session, hours, sessionId) };
  }
  const updated = await adminDb.session.update({
    where: { id: session.id },
    data: { expiresAt: new Date(proposed) },
  });
  invalidateMeContext({ userId });
  return { extended: true, session: summariseSession(updated, hours, sessionId) };
}

export interface SessionPolicy {
  lifetimeHours: number;
  options: readonly number[];
  defaultHours: number;
  maxAbsoluteHours: number;
  warnSecondsBeforeExpiry: number;
}

export async function getSessionPolicy(ctx: AuthContext): Promise<SessionPolicy> {
  requirePermission(ctx, "security.manage");
  return {
    lifetimeHours: await getSessionLifetimeHours(ctx.organizationId),
    options: SESSION_LIFETIME_OPTIONS,
    defaultHours: DEFAULT_SESSION_LIFETIME_HOURS,
    maxAbsoluteHours: MAX_ABSOLUTE_SESSION_HOURS,
    warnSecondsBeforeExpiry: EXPIRY_WARNING_SECONDS,
  };
}

/** Management sets how long sessions last. Applies to new sign-ins and to every "Stay signed in" from now on. */
export async function updateSessionPolicy(
  ctx: AuthContext,
  lifetimeHours: number,
): Promise<SessionPolicy> {
  requirePermission(ctx, "security.manage");
  const previous = await getSessionLifetimeHours(ctx.organizationId);
  const next = await setSessionLifetimeHours(ctx.organizationId, lifetimeHours);
  if (previous !== next) {
    await recordAuditEvent({
      organizationId: ctx.organizationId,
      actorMembershipId: ctx.membershipId,
      action: "security.session_policy_changed",
      entityType: "Organization",
      entityId: ctx.organizationId,
      previousValue: { lifetimeHours: previous },
      newValue: { lifetimeHours: next },
    });
  }
  return getSessionPolicy(ctx);
}
