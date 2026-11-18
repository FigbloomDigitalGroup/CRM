import type { Prisma, PlatformIdentity } from "@prisma/client";
import { deliverOrLog } from "../auth/email";
import { NotFoundError, UnauthorizedError, ValidationError } from "../auth/errors";
import { hashPassword } from "../auth/password";
import {
  requirePlatformPermission,
  revokePlatformSessionsFor,
  type PlatformContext,
} from "../auth/platformSession";
import {
  MIN_ACTIVE_PLATFORM_ADMINS,
  PLATFORM_SETTING_DEFS,
  loadPlatformSettings,
  validatePlatformSettingsPatch,
  type PlatformSecuritySettings,
  type PlatformSettingName,
} from "../auth/platformSettings";
import { enforceRateLimit } from "../auth/rateLimiter";
import { hashToken, newToken } from "../auth/twoStep/secretBox";
import { platformTwoStep } from "../auth/twoStep/stores";
import { getPlatformDb } from "../db/platformClient";
import { ApiError } from "../lib/apiErrors";
import { recordPlatformAudit } from "./platformAuditService";
import { emailSecurityAlert } from "./securityAlertService";

/**
 * Safe administration of the platform admins themselves (FIG-1140, B6.08,
 * design PL10, PL11, PL14). Runs as the platform database role only.
 *
 *   - Minimum two: nobody can suspend or remove an active admin while that would
 *     leave fewer than two (a rule, not a setting). The count and the change run
 *     in one transaction under an advisory lock, so two admins removing each other
 *     at the same moment cannot both succeed.
 *   - Verify it's you: every change here needs a verification no older than the
 *     "verification window" platform setting (default 15 minutes), given with a
 *     fresh authenticator or backup code (`reverify`).
 *   - Recovery: a lost device is reset by ANOTHER admin (the identity re-enrols at
 *     next sign-in, sessions end); a lost password gets a single-use recovery
 *     link that also resets two-step. The break-glass path when no admin can sign
 *     in is an operator running `npm run platform:bootstrap-admin` against the
 *     database (docs/PLATFORM_ADMINS.md).
 *   - Every action is one entry in the platform audit log (FIG-1138).
 */
export const PLATFORM_MIN_PASSWORD_LENGTH = 12;
const INVITE_DAYS = 7;
/** A recovery link resets a password and the second step, so it lives one day, not a week (G2.02, F-05). */
const RECOVERY_HOURS = 24;
const DAY_MS = 24 * 60 * 60 * 1000;
const ADMIN_LOCK_KEY = 1134_1140; // advisory lock: platform admin roster changes, one at a time

type Meta = Record<string, string | number | boolean | null>;

async function audit(ctx: Pick<PlatformContext, "identityId" | "email">, action: string, targetType: string, targetId: string | null, metadata: Meta = {}) {
  await recordPlatformAudit(getPlatformDb(), { actorIdentityId: ctx.identityId, actorLabel: ctx.email, action, targetType, targetId, metadata });
}

function appUrl(): string {
  return process.env.APP_BASE_URL ?? "http://localhost:3000";
}

// ---------------------------------------------------------------------------
// Verify it's you
// ---------------------------------------------------------------------------

/** 403 with a message that starts "Verify it's you": the console shows PL11's step-up prompt. (The V1 error-code list is frozen, so there is no dedicated code yet.) */
export class ReverificationRequiredError extends ApiError {
  constructor() {
    super(403, "FORBIDDEN", "Verify it's you: enter a code from your authenticator app to continue.");
    this.name = "ReverificationRequiredError";
  }
}

/** Throws unless this session proved the admin recently. The dev Super Admin (no second step) is exempt, in development only. */
export async function requireRecentVerification(ctx: PlatformContext): Promise<void> {
  if (ctx.source === "dev") return;
  const { reverifyMinutes } = await loadPlatformSettings();
  if (!ctx.verifiedAt || Date.now() - ctx.verifiedAt.getTime() > reverifyMinutes * 60_000) throw new ReverificationRequiredError();
}

/** Step-up: a fresh code (authenticator or backup) renews this session's verification. */
export async function reverify(ctx: PlatformContext, code: string, ipAddress: string | null): Promise<{ verifiedAt: string; validForMinutes: number }> {
  if (ctx.source === "dev" || !ctx.sessionId) throw new ValidationError("This account has no second step to verify.");
  const windowMs = Number(process.env.TWO_STEP_RATE_LIMIT_WINDOW_MS) > 0 ? Number(process.env.TWO_STEP_RATE_LIMIT_WINDOW_MS) : 15 * 60_000;
  const max = Number(process.env.TWO_STEP_RATE_LIMIT_MAX_PER_USER) > 0 ? Number(process.env.TWO_STEP_RATE_LIMIT_MAX_PER_USER) : 10;
  await enforceRateLimit("TWO_STEP_VERIFY", [
    { scope: "platform-user", key: ctx.identityId, windowMs, max },
    { scope: "platform-ip", key: ipAddress, windowMs, max: max * 3 },
  ]);
  const result = await platformTwoStep().verifyAnyCode(ctx.identityId, code);
  if (!result) {
    await audit(ctx, "platform.reverify_failed", "PlatformIdentity", ctx.identityId);
    throw new UnauthorizedError("That code is not right.");
  }
  const now = new Date();
  await getPlatformDb().platformSession.update({ where: { id: ctx.sessionId }, data: { verifiedAt: now } });
  await audit(ctx, "platform.reverified", "PlatformIdentity", ctx.identityId, { method: result.method });
  if (result.method === "backup") await emailSecurityAlert(ctx.email, "backup_code_used", { remaining: result.backupCodesRemaining ?? 0 });
  return { verifiedAt: now.toISOString(), validForMinutes: (await loadPlatformSettings()).reverifyMinutes };
}

// ---------------------------------------------------------------------------
// The roster
// ---------------------------------------------------------------------------

export interface PlatformAdminSummary {
  id: string;
  email: string;
  name: string;
  status: string;
  twoStepEnabled: boolean;
  lastSignInAt: string | null;
  locked: boolean;
  isYou: boolean;
}

export interface PlatformInviteSummary {
  id: string;
  kind: string;
  email: string;
  expiresAt: string;
  createdAt: string;
}

export async function listPlatformAdmins(ctx: PlatformContext) {
  requirePlatformPermission(ctx, "platform.admins.manage");
  const db = getPlatformDb();
  const [identities, twoStep, invites] = await Promise.all([
    db.platformIdentity.findMany({ where: { isDev: false }, orderBy: { createdAt: "asc" } }),
    db.platformTwoStep.findMany({ where: { enabledAt: { not: null } }, select: { platformIdentityId: true } }),
    db.platformAdminInvite.findMany({ where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } }),
  ]);
  const enrolled = new Set(twoStep.map((t) => t.platformIdentityId));
  const now = Date.now();
  const admins: PlatformAdminSummary[] = identities.map((i) => ({
    id: i.id,
    email: i.email,
    name: i.name,
    status: i.status,
    twoStepEnabled: enrolled.has(i.id),
    lastSignInAt: i.lastSignInAt?.toISOString() ?? null,
    locked: !!i.lockedUntil && i.lockedUntil.getTime() > now,
    isYou: i.id === ctx.identityId,
  }));
  const invitations: PlatformInviteSummary[] = invites.map((i) => ({ id: i.id, kind: i.kind, email: i.email, expiresAt: i.expiresAt.toISOString(), createdAt: i.createdAt.toISOString() }));
  return {
    items: admins,
    invitations,
    activeCount: admins.filter((a) => a.status === "ACTIVE").length,
    minimumActive: MIN_ACTIVE_PLATFORM_ADMINS,
  };
}

async function loadManaged(targetId: string, tx: Pick<Prisma.TransactionClient, "platformIdentity">): Promise<PlatformIdentity> {
  const target = await tx.platformIdentity.findUnique({ where: { id: targetId } });
  // The dev Super Admin is a development fixture, not part of the managed roster.
  if (!target || target.isDev) throw new NotFoundError("Platform admin", targetId);
  return target;
}

/** Inside the roster lock: refuses when taking this active admin out would leave fewer than the minimum. */
async function assertMinimumAfterLosing(tx: Prisma.TransactionClient, target: PlatformIdentity): Promise<void> {
  if (target.status !== "ACTIVE") return;
  const active = await tx.platformIdentity.count({ where: { status: "ACTIVE", isDev: false } });
  if (active - 1 < MIN_ACTIVE_PLATFORM_ADMINS) {
    throw new ValidationError(
      `There must always be at least ${MIN_ACTIVE_PLATFORM_ADMINS} active platform admins. Invite another admin first.`,
      [{ path: "minimumActive", message: `Only ${active} active; at least ${MIN_ACTIVE_PLATFORM_ADMINS} must remain.` }],
    );
  }
}

async function lockRoster(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADMIN_LOCK_KEY})`;
}

function refuseSelf(ctx: PlatformContext, targetId: string, what: string): void {
  if (ctx.identityId === targetId) throw new ValidationError(`You cannot ${what} yourself. Ask another platform admin.`);
}

export async function suspendPlatformAdmin(ctx: PlatformContext, targetId: string): Promise<{ status: "SUSPENDED" }> {
  requirePlatformPermission(ctx, "platform.admins.manage");
  await requireRecentVerification(ctx);
  refuseSelf(ctx, targetId, "suspend");
  const target = await getPlatformDb().$transaction(async (tx) => {
    await lockRoster(tx);
    const t = await loadManaged(targetId, tx);
    await assertMinimumAfterLosing(tx, t);
    await tx.platformIdentity.update({ where: { id: t.id }, data: { status: "SUSPENDED" } });
    return t;
  });
  await revokePlatformSessionsFor(target.id, "SUSPENDED");
  await audit(ctx, "platform.admin_suspended", "PlatformIdentity", target.id, { email: target.email });
  return { status: "SUSPENDED" };
}

export async function reinstatePlatformAdmin(ctx: PlatformContext, targetId: string): Promise<{ status: "ACTIVE" }> {
  requirePlatformPermission(ctx, "platform.admins.manage");
  await requireRecentVerification(ctx);
  const db = getPlatformDb();
  const target = await loadManaged(targetId, db);
  await db.platformIdentity.update({ where: { id: target.id }, data: { status: "ACTIVE", failedSignInCount: 0, lockedUntil: null } });
  await audit(ctx, "platform.admin_reinstated", "PlatformIdentity", target.id, { email: target.email });
  return { status: "ACTIVE" };
}

export async function removePlatformAdmin(ctx: PlatformContext, targetId: string): Promise<{ removed: true }> {
  requirePlatformPermission(ctx, "platform.admins.manage");
  await requireRecentVerification(ctx);
  refuseSelf(ctx, targetId, "remove");
  const target = await getPlatformDb().$transaction(async (tx) => {
    await lockRoster(tx);
    const t = await loadManaged(targetId, tx);
    await assertMinimumAfterLosing(tx, t);
    await tx.platformSession.updateMany({ where: { platformIdentityId: t.id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: "REVOKED" } });
    await tx.platformIdentity.delete({ where: { id: t.id } }); // cascades its sessions, second step and open links
    return t;
  });
  await audit(ctx, "platform.admin_removed", "PlatformIdentity", target.id, { email: target.email });
  return { removed: true };
}

// ---------------------------------------------------------------------------
// Invitations and recovery
// ---------------------------------------------------------------------------

/** The live link is never returned from an API: it goes to the person's email only. Only the operator script gets the URL (see issueOperatorLink). */
function withoutUrl<T extends { inviteUrl: string }>(link: T): Omit<T, "inviteUrl"> {
  const rest: Record<string, unknown> = { ...link };
  delete rest.inviteUrl;
  return rest as Omit<T, "inviteUrl">;
}

async function issueLink(ctx: PlatformContext | null, input: { kind: "INVITE" | "RECOVERY"; email: string; name?: string | null; identityId?: string | null }) {
  const db = getPlatformDb();
  const token = newToken();
  const lifetimeMs = input.kind === "RECOVERY" ? RECOVERY_HOURS * 3_600_000 : INVITE_DAYS * DAY_MS;
  const lifetimeText = input.kind === "RECOVERY" ? `${RECOVERY_HOURS} hours` : `${INVITE_DAYS} days`;
  const expiresAt = new Date(Date.now() + lifetimeMs);
  // One live link per email and kind: a new one replaces the old.
  await db.platformAdminInvite.updateMany({ where: { email: input.email, kind: input.kind, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
  const row = await db.platformAdminInvite.create({
    data: { kind: input.kind, email: input.email, name: input.name ?? null, platformIdentityId: input.identityId ?? null, tokenHash: hashToken(token), invitedById: ctx?.identityId ?? null, expiresAt },
  });
  const url = `${appUrl()}/platform/accept-invite?token=${token}`;
  await deliverOrLog(
    input.kind === "INVITE" ? "platform-admin-invite" : "platform-admin-recovery",
    {
      to: input.email,
      subject: input.kind === "INVITE" ? "You have been invited as a FigBloom platform admin" : "Recover your FigBloom platform admin account",
      text: `Use this link to set your password${input.kind === "RECOVERY" ? " and set up two-step sign-in again" : ""}. It expires in ${lifetimeText} and works once.\n\n${url}`,
      html: `<p>Use this link to set your password${input.kind === "RECOVERY" ? " and set up two-step sign-in again" : ""}. It expires in ${lifetimeText} and works once.</p><p><a href="${url}">${url}</a></p>`,
    },
  ).catch((err) => console.error("[platform-admin] could not send the link:", err instanceof Error ? err.message : "unknown error"));
  return { id: row.id, email: input.email, expiresAt: expiresAt.toISOString(), inviteUrl: url };
}

export async function invitePlatformAdmin(ctx: PlatformContext, input: { email: string; name: string }) {
  requirePlatformPermission(ctx, "platform.admins.manage");
  await requireRecentVerification(ctx);
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError("Enter a valid email address.", [{ path: "email", message: "Enter a valid email address." }]);
  if (!input.name.trim()) throw new ValidationError("Name is required.", [{ path: "name", message: "Name is required." }]);
  if (await getPlatformDb().platformIdentity.findUnique({ where: { email } })) {
    throw new ValidationError("That person is already a platform admin.", [{ path: "email", message: "Already a platform admin." }]);
  }
  const link = await issueLink(ctx, { kind: "INVITE", email, name: input.name.trim() });
  await audit(ctx, "platform.admin_invited", "PlatformAdminInvite", link.id, { email });
  return withoutUrl(link);
}

export async function revokePlatformInvite(ctx: PlatformContext, inviteId: string): Promise<{ revoked: true }> {
  requirePlatformPermission(ctx, "platform.admins.manage");
  await requireRecentVerification(ctx);
  const r = await getPlatformDb().platformAdminInvite.updateMany({ where: { id: inviteId, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
  if (r.count === 0) throw new NotFoundError("Invitation", inviteId);
  await audit(ctx, "platform.admin_invite_revoked", "PlatformAdminInvite", inviteId);
  return { revoked: true };
}

/** A lost device: another admin removes the second step and ends the sessions; the person enrols again at next sign-in. */
export async function resetPlatformAdminTwoStep(ctx: PlatformContext, targetId: string): Promise<{ reset: true }> {
  requirePlatformPermission(ctx, "platform.admins.manage");
  await requireRecentVerification(ctx);
  refuseSelf(ctx, targetId, "reset the two-step sign-in of");
  const db = getPlatformDb();
  const target = await loadManaged(targetId, db);
  await platformTwoStep().disable(target.id);
  await db.platformIdentity.update({ where: { id: target.id }, data: { credentialsResetAt: new Date() } });
  await revokePlatformSessionsFor(target.id, "REVOKED");
  await audit(ctx, "platform.admin_two_step_reset", "PlatformIdentity", target.id, { email: target.email });
  await emailSecurityAlert(target.email, "two_step_reset_by_admin");
  return { reset: true };
}

/** A lost password: a single-use link that sets a new password, resets two-step and ends sessions once used. */
export async function issuePlatformRecoveryLink(ctx: PlatformContext, targetId: string) {
  requirePlatformPermission(ctx, "platform.admins.manage");
  await requireRecentVerification(ctx);
  refuseSelf(ctx, targetId, "recover");
  const db = getPlatformDb();
  // Only a different, active, managed admin may issue it. The link itself goes to the target's own mailbox and is never
  // returned here, so the issuer cannot open it and become the target.
  const issuer = await db.platformIdentity.findUnique({ where: { id: ctx.identityId } });
  if (!issuer || issuer.isDev || issuer.status !== "ACTIVE" || issuer.id === targetId) throw new ValidationError("Only another active platform admin can issue a recovery link.");
  const target = await loadManaged(targetId, db);
  const link = await issueLink(ctx, { kind: "RECOVERY", email: target.email, identityId: target.id });
  await audit(ctx, "platform.admin_recovery_issued", "PlatformIdentity", target.id, { email: target.email });
  return withoutUrl(link);
}

/** Public: the person opens the emailed link and chooses a password. Creates the identity (INVITE) or resets it (RECOVERY). No session is issued: they sign in next, and enrol. */
export async function acceptPlatformInvite(token: string, password: string, name: string | null, ipAddress: string | null): Promise<{ email: string; kind: "INVITE" | "RECOVERY" }> {
  await enforceRateLimit("INVITE_ACCEPT", [{ scope: "platform-ip", key: ipAddress, windowMs: 60 * 60_000, max: 20 }]);
  if (password.length < PLATFORM_MIN_PASSWORD_LENGTH) {
    throw new ValidationError(`Password must be at least ${PLATFORM_MIN_PASSWORD_LENGTH} characters.`, [{ path: "password", message: `At least ${PLATFORM_MIN_PASSWORD_LENGTH} characters.` }]);
  }
  const db = getPlatformDb();
  const invite = await db.platformAdminInvite.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!invite || invite.acceptedAt || invite.revokedAt || invite.expiresAt.getTime() <= Date.now()) {
    throw new ValidationError("This link is invalid or has expired. Ask another platform admin for a new one.");
  }
  const passwordHash = await hashPassword(password);
  const kind = invite.kind as "INVITE" | "RECOVERY";

  const claimed = await db.platformAdminInvite.updateMany({ where: { id: invite.id, acceptedAt: null }, data: { acceptedAt: new Date() } });
  if (claimed.count !== 1) throw new ValidationError("This link is invalid or has expired. Ask another platform admin for a new one.");

  let identityId: string;
  if (kind === "INVITE") {
    try {
      const created = await db.platformIdentity.create({ data: { email: invite.email, name: (name ?? invite.name ?? invite.email).trim(), passwordHash, isDev: false, credentialsResetAt: new Date() } });
      identityId = created.id;
    } catch {
      throw new ValidationError("That person is already a platform admin.");
    }
  } else {
    if (!invite.platformIdentityId) throw new ValidationError("This link is invalid.");
    identityId = invite.platformIdentityId;
    await db.platformIdentity.update({ where: { id: identityId }, data: { passwordHash, failedSignInCount: 0, lockedUntil: null, credentialsResetAt: new Date() } });
    await platformTwoStep().disable(identityId);
    await revokePlatformSessionsFor(identityId, "REVOKED");
  }
  await recordPlatformAudit(db, {
    actorIdentityId: identityId,
    actorLabel: invite.email,
    action: kind === "INVITE" ? "platform.admin_joined" : "platform.admin_recovered",
    targetType: "PlatformIdentity",
    targetId: identityId,
    metadata: { email: invite.email },
  });
  return { email: invite.email, kind };
}

// ---------------------------------------------------------------------------
// Platform security settings
// ---------------------------------------------------------------------------

export async function getPlatformSecuritySettings(ctx: PlatformContext) {
  requirePlatformPermission(ctx, "platform.security.manage");
  const settings = await loadPlatformSettings();
  return {
    settings,
    limits: Object.fromEntries(Object.entries(PLATFORM_SETTING_DEFS).map(([name, d]) => [name, { label: d.label, min: d.min, max: d.max, default: d.default }])),
    minimumActiveAdmins: MIN_ACTIVE_PLATFORM_ADMINS,
    twoStep: "required for every platform admin",
  };
}

export async function updatePlatformSecuritySettings(ctx: PlatformContext, patch: Partial<Record<PlatformSettingName, unknown>>) {
  requirePlatformPermission(ctx, "platform.security.manage");
  await requireRecentVerification(ctx);
  const current = await loadPlatformSettings();
  const clean = validatePlatformSettingsPatch(patch, current);
  const db = getPlatformDb();
  const changes: Meta = {};
  for (const [name, value] of Object.entries(clean) as [PlatformSettingName, number][]) {
    if (value === current[name]) continue;
    const key = PLATFORM_SETTING_DEFS[name].key;
    await db.platformSetting.upsert({ where: { key }, create: { key, value, updatedById: ctx.identityId }, update: { value, updatedById: ctx.identityId } });
    changes[`${name}_was`] = current[name];
    changes[`${name}_now`] = value;
  }
  if (Object.keys(changes).length > 0) await audit(ctx, "platform.security_settings_changed", "PlatformSettings", null, changes);
  return getPlatformSecuritySettings(ctx);
}

export type { PlatformSecuritySettings };

/**
 * Operator path (npm run platform:bootstrap-admin): the first platform admin, or the break-glass when no admin can sign in.
 * Not an API route: it needs the database credentials, which is the point. Issues an invitation (or, for an existing
 * identity, a recovery link) and records it in the platform audit log as done by "operator".
 */
export async function issueOperatorLink(email: string, name: string) {
  const normalised = email.trim().toLowerCase();
  const db = getPlatformDb();
  const existing = await db.platformIdentity.findUnique({ where: { email: normalised } });
  if (existing?.isDev) throw new ValidationError("That is the development Super Admin fixture; it has no password sign-in.");
  const link = await issueLink(null, existing ? { kind: "RECOVERY", email: normalised, identityId: existing.id } : { kind: "INVITE", email: normalised, name });
  await recordPlatformAudit(db, {
    actorIdentityId: null,
    actorLabel: "operator",
    action: existing ? "platform.admin_recovery_issued" : "platform.admin_invited",
    targetType: existing ? "PlatformIdentity" : "PlatformAdminInvite",
    targetId: existing?.id ?? link.id,
    metadata: { email: normalised, by: "operator" },
  });
  return { ...link, kind: existing ? "RECOVERY" : "INVITE" };
}
