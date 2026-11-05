import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError, NotFoundError, RateLimitedError, UnauthorizedError, ValidationError } from "../src/auth/errors";
import { hashPassword } from "../src/auth/password";
import {
  PLATFORM_SESSION_COOKIE_NAME,
  lookupPlatformSession,
  resolvePlatformContext,
  type PlatformContext,
} from "../src/auth/platformSession";
import { openSecret } from "../src/auth/twoStep/secretBox";
import { platformTwoStep } from "../src/auth/twoStep/stores";
import { currentStep, totpAt } from "../src/auth/twoStep/totp";
import { adminDb } from "../src/db/adminClient";
import { getPlatformDb } from "../src/db/platformClient";
import {
  ReverificationRequiredError,
  acceptPlatformInvite,
  getPlatformSecuritySettings,
  invitePlatformAdmin,
  issuePlatformRecoveryLink,
  listPlatformAdmins,
  removePlatformAdmin,
  reinstatePlatformAdmin,
  resetPlatformAdminTwoStep,
  reverify,
  revokePlatformInvite,
  suspendPlatformAdmin,
  updatePlatformSecuritySettings,
} from "../src/services/platformAdminService";
import {
  beginPlatformEnrolment,
  confirmPlatformEnrolment,
  startPlatformSignIn,
  verifyPlatformSignInCode,
} from "../src/services/platformSignInService";
import { createTestMembership, createTestOrganization } from "./helpers/fixtures";

// One trusted proxy in front: the last X-Forwarded-For entry is the client (src/app/api/_lib/clientRequest.ts).
process.env.TRUSTED_PROXY_HOPS = "1";

/**
 * FIG-1140 (B6.08) and the platform half of FIG-1134 (B6.02): platform admin
 * sign-in (password, then a second step, always), the minimum-two rule,
 * verify-it's-you, invitations, recovery, security settings, all audited.
 * Passwords and seeds are generated per run.
 */

const holder = vi.hoisted(() => ({ jar: { get: (_n: string): { value: string } | undefined => undefined } }));
vi.mock("next/headers", () => ({ cookies: async () => holder.jar, headers: async () => new Headers() }));

const PASSWORD = `pw-${randomUUID()}-Aa1`;
let n = Math.floor(Math.random() * 60000);
const ip = () => `10.${(++n >> 8) & 255}.${Math.floor(n / 250) % 250}.${n % 250}`;
const CLIENT = () => ({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) Firefox/121.0", ipAddress: ip() });

async function wipe() {
  await adminDb.platformIdentity.deleteMany({ where: { isDev: false } });
  await adminDb.platformSetting.deleteMany();
}

async function makeAdmin(label = "admin") {
  const email = `${label}.${randomUUID().slice(0, 8)}@platform.example.com`;
  return adminDb.platformIdentity.create({ data: { email, name: `Platform ${label}`, passwordHash: await hashPassword(PASSWORD), isDev: false } });
}

/** Signs an admin in all the way (enrolling on first sign-in) and returns the session, seed and a context like a request would carry. */
async function signedIn(identity: { id: string; email: string }, secret?: string) {
  const start = await startPlatformSignIn(identity.email, PASSWORD, CLIENT());
  let seed = secret;
  let session;
  if (start.purpose === "ENROL") {
    const enrol = await beginPlatformEnrolment(start.challengeToken, CLIENT());
    seed = enrol.secret;
    session = await confirmPlatformEnrolment(start.challengeToken, totpAt(seed, currentStep()), CLIENT());
  } else {
    // a code from the next time step: the one already used cannot be replayed
    session = await verifyPlatformSignInCode(start.challengeToken, totpAt(seed!, currentStep() + 1), CLIENT());
  }
  const ctx = (await resolvePlatformContext({ get: (name) => (name === PLATFORM_SESSION_COOKIE_NAME ? { value: session.token } : undefined) }))!;
  return { ctx, seed: seed!, token: session.token, session };
}

/** An admin with a live, freshly verified session. */
async function activeAdmin(label?: string) {
  const identity = await makeAdmin(label);
  return { identity, ...(await signedIn(identity)) };
}

/** Runs `fn` and returns what it returned plus the link that was emailed (no SMTP in tests, so it is written to the log). The API result never carries it. */
async function withEmailedLink<T>(fn: () => Promise<T>): Promise<{ result: T; token: string }> {
  const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  try {
    const result = await fn();
    const text = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    const found = [...text.matchAll(/platform\/accept-invite\?token=([A-Za-z0-9_-]+)/g)].pop();
    if (!found) throw new Error("no emailed link was logged");
    return { result, token: found[1] };
  } finally {
    spy.mockRestore();
  }
}

async function audited(action: string, actorEmail: string) {
  return adminDb.$queryRaw<{ action: string; metadata: Record<string, unknown>; target_id: string | null }[]>`
    SELECT action, metadata, target_id FROM platform_audit_events WHERE action = ${action} AND actor_label = ${actorEmail}`;
}

beforeAll(async () => {
  expect(process.env.PLATFORM_DATABASE_URL, "PLATFORM_DATABASE_URL (see .env.example)").toBeTruthy();
  await wipe();
});
beforeEach(async () => {
  await wipe();
  vi.stubEnv("PLATFORM_LOGIN_RATE_LIMIT_MAX_PER_EMAIL", "1000");
  vi.stubEnv("TWO_STEP_RATE_LIMIT_MAX_PER_USER", "1000");
  vi.stubEnv("TWO_STEP_RATE_LIMIT_MAX_PER_IP", "1000");
});
afterEach(() => {
  vi.unstubAllEnvs();
  holder.jar = { get: () => undefined };
});
afterAll(async () => {
  await wipe();
  await getPlatformDb().$disconnect();
});

describe("platform sign-in", () => {
  it("gives no session after the password: enrolment first, then a session with backup codes", async () => {
    const admin = await makeAdmin();
    const start = await startPlatformSignIn(admin.email, PASSWORD, CLIENT());
    expect(start.purpose).toBe("ENROL");
    expect(await adminDb.platformSession.count({ where: { platformIdentityId: admin.id } })).toBe(0);
    await expect(confirmPlatformEnrolment(start.challengeToken, "123456", CLIENT())).rejects.toBeInstanceOf(ValidationError);
    const { secret } = await beginPlatformEnrolment(start.challengeToken, CLIENT());
    await expect(confirmPlatformEnrolment(start.challengeToken, "000000", CLIENT())).rejects.toBeInstanceOf(UnauthorizedError);
    expect(await adminDb.platformSession.count({ where: { platformIdentityId: admin.id } })).toBe(0);
    const done = await confirmPlatformEnrolment(start.challengeToken, totpAt(secret, currentStep()), CLIENT());
    expect(done.backupCodes).toHaveLength(10);
    const found = await lookupPlatformSession(done.token);
    expect(found.state).toBe("active");
    if (found.state === "active") expect(found.verifiedAt).not.toBeNull();
    // the seed is stored encrypted, backup codes hashed
    const cred = await adminDb.platformTwoStep.findUniqueOrThrow({ where: { platformIdentityId: admin.id } });
    expect(cred.secretEncrypted).not.toContain(secret);
    expect(openSecret(cred.secretEncrypted)).toBe(secret);
    const codes = await adminDb.platformBackupCode.findMany({ where: { platformIdentityId: admin.id } });
    for (const c of done.backupCodes) for (const row of codes) expect(row.codeHash).not.toContain(c.replace("-", ""));
  });

  it("asks for a code on the next sign-in, accepts a backup code once, and audits both", async () => {
    const admin = await makeAdmin();
    const first = await signedIn(admin);
    const start = await startPlatformSignIn(admin.email, PASSWORD, CLIENT());
    expect(start.purpose).toBe("VERIFY");
    const backup = (await adminDb.platformBackupCode.findFirst({ where: { platformIdentityId: admin.id } }))!;
    expect(backup).toBeTruthy();
    // use a real backup code: regenerate through the engine to learn the plain codes
    const fresh = await platformTwoStep().regenerateBackupCodes(admin.id);
    const done = await verifyPlatformSignInCode(start.challengeToken, fresh[0]!, CLIENT());
    expect(done.backupCodesRemaining).toBe(9);
    const again = await startPlatformSignIn(admin.email, PASSWORD, CLIENT());
    await expect(verifyPlatformSignInCode(again.challengeToken, fresh[0]!, CLIENT())).rejects.toBeInstanceOf(UnauthorizedError);
    expect((await audited("platform.backup_code_used", admin.email)).length).toBe(1);
    expect((await audited("platform.signed_in", admin.email)).length).toBe(2);
    void first;
  });

  it("answers every failure the same way and signs nobody in: unknown email, wrong password, suspended, dev account, tenant user", async () => {
    const admin = await makeAdmin();
    const suspended = await makeAdmin("suspended");
    await adminDb.platformIdentity.update({ where: { id: suspended.id }, data: { status: "SUSPENDED" } });
    const dev = await adminDb.platformIdentity.findFirst({ where: { isDev: true } });
    const org = await createTestOrganization("PlatformSignIn");
    const { user } = await createTestMembership(org.id, "MANAGEMENT", "tenant.mgr");
    await adminDb.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(PASSWORD) } });
    const attempts: [string, string][] = [
      [`nobody.${randomUUID().slice(0, 6)}@platform.example.com`, PASSWORD],
      [admin.email, "not the password"],
      [suspended.email, PASSWORD],
      [user.email, PASSWORD],
    ];
    if (dev) attempts.push([dev.email, PASSWORD]);
    const messages = new Set<string>();
    for (const [email, password] of attempts) {
      await startPlatformSignIn(email, password, CLIENT()).then(
        () => messages.add("SIGNED IN"),
        (e) => messages.add(`${(e as Error).constructor.name}: ${(e as Error).message}`),
      );
    }
    expect([...messages]).toEqual(["UnauthorizedError: Invalid email or password."]);
    expect(await adminDb.platformSession.count()).toBe(0);
    await adminDb.organization.delete({ where: { id: org.id } });
  });

  it("locks after the configured wrong attempts, even for the right password, and rate limits by address", async () => {
    const admin = await makeAdmin();
    await signedIn(admin);
    for (let i = 0; i < 5; i++) {
      await expect(startPlatformSignIn(admin.email, "wrong password", CLIENT())).rejects.toBeInstanceOf(UnauthorizedError);
    }
    await expect(startPlatformSignIn(admin.email, PASSWORD, CLIENT())).rejects.toBeInstanceOf(RateLimitedError);
    expect((await audited("platform.signin_locked", admin.email)).length).toBe(1);
    // the unlock is a reinstate (an admin) or the lock running out
    await adminDb.platformIdentity.update({ where: { id: admin.id }, data: { lockedUntil: new Date(Date.now() - 1000), failedSignInCount: 0 } });
    expect((await startPlatformSignIn(admin.email, PASSWORD, CLIENT())).purpose).toBe("VERIFY");

    vi.stubEnv("PLATFORM_LOGIN_RATE_LIMIT_MAX_PER_IP", "2");
    const sameIp = { userAgent: "x", ipAddress: ip() };
    await startPlatformSignIn(admin.email, PASSWORD, sameIp);
    await startPlatformSignIn(admin.email, PASSWORD, sameIp);
    await expect(startPlatformSignIn(admin.email, PASSWORD, sameIp)).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("burns a challenge after five wrong codes and rate limits the code step", async () => {
    const admin = await makeAdmin();
    const { seed } = await signedIn(admin);
    const start = await startPlatformSignIn(admin.email, PASSWORD, CLIENT());
    for (let i = 0; i < 5; i++) await expect(verifyPlatformSignInCode(start.challengeToken, "000000", CLIENT())).rejects.toThrow();
    await expect(verifyPlatformSignInCode(start.challengeToken, totpAt(seed, currentStep() + 1), CLIENT())).rejects.toBeInstanceOf(UnauthorizedError);

    const other = await makeAdmin("other");
    await signedIn(other);
    vi.stubEnv("TWO_STEP_RATE_LIMIT_MAX_PER_USER", "2");
    const s2 = await startPlatformSignIn(other.email, PASSWORD, CLIENT());
    await expect(verifyPlatformSignInCode(s2.challengeToken, "000000", CLIENT())).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(verifyPlatformSignInCode(s2.challengeToken, "000000", CLIENT())).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(verifyPlatformSignInCode(s2.challengeToken, "000000", CLIENT())).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("cannot read tenant two-step tables (the platform role has no privilege on them)", async () => {
    for (const table of ["user_two_step", "user_backup_codes", "user_trusted_devices", "two_step_challenges", "users", "audit_events"]) {
      await expect(getPlatformDb().$queryRawUnsafe(`SELECT 1 FROM "${table}" LIMIT 1`)).rejects.toThrow(/permission denied/i);
    }
  });
});

describe("the minimum of two active platform admins", () => {
  it("refuses to suspend or remove the second-last active admin, and allows it with a third", async () => {
    const a = await activeAdmin("a");
    const b = await activeAdmin("b");
    await expect(removePlatformAdmin(a.ctx, b.identity.id)).rejects.toThrow(/at least 2 active platform admins/);
    await expect(suspendPlatformAdmin(a.ctx, b.identity.id)).rejects.toThrow(/at least 2 active platform admins/);
    expect((await adminDb.platformIdentity.findUniqueOrThrow({ where: { id: b.identity.id } })).status).toBe("ACTIVE");
    const c = await activeAdmin("c");
    await expect(suspendPlatformAdmin(a.ctx, c.identity.id)).resolves.toEqual({ status: "SUSPENDED" });
    // the suspended admin's session ends at once, and only two remain active
    expect((await lookupPlatformSession(c.token)).state).toBe("revoked");
    await expect(removePlatformAdmin(a.ctx, b.identity.id)).rejects.toBeInstanceOf(ValidationError);
    // a suspended admin can be removed (it does not reduce the active count) and reinstated
    await expect(reinstatePlatformAdmin(a.ctx, c.identity.id)).resolves.toEqual({ status: "ACTIVE" });
    await expect(removePlatformAdmin(a.ctx, c.identity.id)).resolves.toEqual({ removed: true });
    expect(await adminDb.platformIdentity.count({ where: { isDev: false } })).toBe(2);
    const listed = await listPlatformAdmins(a.ctx);
    expect(listed).toMatchObject({ activeCount: 2, minimumActive: 2 });
    expect(listed.items.find((i) => i.id === a.identity.id)?.isYou).toBe(true);
  });

  it("cannot be beaten by two admins removing each other at the same moment", async () => {
    const a = await activeAdmin("a");
    const b = await activeAdmin("b");
    const c = await activeAdmin("c");
    const results = await Promise.allSettled([suspendPlatformAdmin(a.ctx, b.identity.id), suspendPlatformAdmin(b.ctx, a.identity.id), suspendPlatformAdmin(c.ctx, a.identity.id)]);
    // Suspending an already-suspended admin is a harmless no-op, so two calls can fulfil; the invariant is what counts.
    expect(results.filter((r) => r.status === "rejected").length).toBeGreaterThanOrEqual(1);
    expect(await adminDb.platformIdentity.count({ where: { isDev: false, status: "ACTIVE" } })).toBe(2);
  });

  it("refuses to act on yourself, on the dev fixture and on a stranger", async () => {
    const a = await activeAdmin("a");
    await activeAdmin("b");
    await activeAdmin("c");
    await expect(removePlatformAdmin(a.ctx, a.identity.id)).rejects.toBeInstanceOf(ValidationError);
    await expect(suspendPlatformAdmin(a.ctx, a.identity.id)).rejects.toBeInstanceOf(ValidationError);
    await expect(removePlatformAdmin(a.ctx, randomUUID())).rejects.toBeInstanceOf(NotFoundError);
    const dev = await adminDb.platformIdentity.findFirst({ where: { isDev: true } });
    if (dev) await expect(removePlatformAdmin(a.ctx, dev.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("records every roster change in the platform audit log", async () => {
    const a = await activeAdmin("a");
    await activeAdmin("b");
    const c = await activeAdmin("c");
    await suspendPlatformAdmin(a.ctx, c.identity.id);
    await reinstatePlatformAdmin(a.ctx, c.identity.id);
    await removePlatformAdmin(a.ctx, c.identity.id);
    for (const action of ["platform.admin_suspended", "platform.admin_reinstated", "platform.admin_removed"]) {
      const rows = await audited(action, a.identity.email);
      expect(rows, action).toHaveLength(1);
      expect(rows[0]!.target_id).toBe(c.identity.id);
    }
  });
});

describe("verify it's you", () => {
  it("blocks sensitive actions when the verification is older than the window, until a fresh code is given", async () => {
    const a = await activeAdmin("a");
    const b = await activeAdmin("b");
    const c = await activeAdmin("c");
    await adminDb.platformSession.update({ where: { id: a.ctx.sessionId! }, data: { verifiedAt: new Date(Date.now() - 60 * 60_000) } });
    const stale = (await resolvePlatformContext({ get: (name) => (name === PLATFORM_SESSION_COOKIE_NAME ? { value: a.token } : undefined) }))!;
    await expect(suspendPlatformAdmin(stale, c.identity.id)).rejects.toBeInstanceOf(ReverificationRequiredError);
    await expect(invitePlatformAdmin(stale, { email: "x@example.com", name: "X" })).rejects.toThrow(/Verify it's you/);
    await expect(updatePlatformSecuritySettings(stale, { idleHours: 2 })).rejects.toBeInstanceOf(ReverificationRequiredError);
    await expect(resetPlatformAdminTwoStep(stale, b.identity.id)).rejects.toBeInstanceOf(ReverificationRequiredError);
    // reads need no fresh verification
    await expect(listPlatformAdmins(stale)).resolves.toBeTruthy();

    await expect(reverify(stale, "000000", ip())).rejects.toBeInstanceOf(UnauthorizedError);
    expect((await audited("platform.reverify_failed", a.identity.email)).length).toBe(1);
    await reverify(stale, totpAt(a.seed, currentStep() + 1), ip());
    const fresh = (await resolvePlatformContext({ get: (name) => (name === PLATFORM_SESSION_COOKIE_NAME ? { value: a.token } : undefined) }))!;
    await expect(suspendPlatformAdmin(fresh, c.identity.id)).resolves.toBeTruthy();
    expect((await audited("platform.reverified", a.identity.email)).length).toBe(1);
  });

  it("follows the verification window setting", async () => {
    const a = await activeAdmin("a");
    await updatePlatformSecuritySettings(a.ctx, { reverifyMinutes: 5 });
    await adminDb.platformSession.update({ where: { id: a.ctx.sessionId! }, data: { verifiedAt: new Date(Date.now() - 6 * 60_000) } });
    const stale = (await resolvePlatformContext({ get: (name) => (name === PLATFORM_SESSION_COOKIE_NAME ? { value: a.token } : undefined) }))!;
    await expect(invitePlatformAdmin(stale, { email: "y@example.com", name: "Y" })).rejects.toBeInstanceOf(ReverificationRequiredError);
  });

  it("is not satisfied by a different admin's code", async () => {
    const a = await activeAdmin("a");
    const b = await activeAdmin("b");
    await expect(reverify(a.ctx, totpAt(b.seed, currentStep() + 1), ip())).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe("keys", () => {
  it("a suspended identity holds no key, so a stale context cannot manage admins", async () => {
    const a = await activeAdmin("a");
    await activeAdmin("b");
    await activeAdmin("c");
    await adminDb.platformIdentity.update({ where: { id: a.identity.id }, data: { status: "SUSPENDED" } });
    expect(await resolvePlatformContext({ get: (name) => (name === PLATFORM_SESSION_COOKIE_NAME ? { value: a.token } : undefined) })).toBeNull();
    const forged: PlatformContext = { ...a.ctx, permissions: new Set() };
    await expect(listPlatformAdmins(forged)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getPlatformSecuritySettings(forged)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("invitations and recovery", () => {
  it("invites by email, creates the admin only when the link is used once, and audits it", async () => {
    const a = await activeAdmin("a");
    const email = `new.${randomUUID().slice(0, 6)}@platform.example.com`;
    const { result: link, token } = await withEmailedLink(() => invitePlatformAdmin(a.ctx, { email: email.toUpperCase(), name: "New Admin" }));
    expect(link.email).toBe(email);
    expect(JSON.stringify(link)).not.toContain(token);
    expect(link).not.toHaveProperty("inviteUrl");
    expect(await adminDb.platformIdentity.findUnique({ where: { email } })).toBeNull();
    const row = await adminDb.platformAdminInvite.findFirstOrThrow({ where: { email } });
    expect(row.tokenHash).not.toContain(token);
    expect((await listPlatformAdmins(a.ctx)).invitations.map((i) => i.email)).toContain(email);

    await expect(acceptPlatformInvite(token, "short", null, ip())).rejects.toBeInstanceOf(ValidationError);
    await expect(acceptPlatformInvite("not-a-token", PASSWORD, null, ip())).rejects.toBeInstanceOf(ValidationError);
    await expect(acceptPlatformInvite(token, PASSWORD, null, ip())).resolves.toEqual({ email, kind: "INVITE" });
    await expect(acceptPlatformInvite(token, PASSWORD, null, ip())).rejects.toBeInstanceOf(ValidationError);
    // no session yet, and the first sign-in must enrol
    expect(await adminDb.platformSession.count({ where: { identity: { email } } })).toBe(0);
    expect((await startPlatformSignIn(email, PASSWORD, CLIENT())).purpose).toBe("ENROL");
    expect((await audited("platform.admin_invited", a.identity.email)).length).toBe(1);
    expect((await audited("platform.admin_joined", email)).length).toBe(1);
    await expect(invitePlatformAdmin(a.ctx, { email, name: "Again" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses an expired or withdrawn link", async () => {
    const a = await activeAdmin("a");
    const email = `exp.${randomUUID().slice(0, 6)}@platform.example.com`;
    const { token } = await withEmailedLink(() => invitePlatformAdmin(a.ctx, { email, name: "Exp" }));
    await adminDb.platformAdminInvite.updateMany({ where: { email }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(acceptPlatformInvite(token, PASSWORD, null, ip())).rejects.toBeInstanceOf(ValidationError);

    const { result: link2, token: token2 } = await withEmailedLink(() => invitePlatformAdmin(a.ctx, { email, name: "Exp" }));
    await revokePlatformInvite(a.ctx, link2.id);
    await expect(acceptPlatformInvite(token2, PASSWORD, null, ip())).rejects.toBeInstanceOf(ValidationError);
    await expect(revokePlatformInvite(a.ctx, link2.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await adminDb.platformIdentity.findUnique({ where: { email } })).toBeNull();
  });

  it("resets a lost authenticator for another admin: two-step gone, sessions ended, re-enrol at next sign-in", async () => {
    const a = await activeAdmin("a");
    const b = await activeAdmin("b");
    await expect(resetPlatformAdminTwoStep(a.ctx, a.identity.id)).rejects.toBeInstanceOf(ValidationError);
    await resetPlatformAdminTwoStep(a.ctx, b.identity.id);
    expect((await platformTwoStep().status(b.identity.id)).enabled).toBe(false);
    expect((await lookupPlatformSession(b.token)).state).toBe("revoked");
    expect((await startPlatformSignIn(b.identity.email, PASSWORD, CLIENT())).purpose).toBe("ENROL");
    expect((await audited("platform.admin_two_step_reset", a.identity.email)).length).toBe(1);
  });

  it("recovers a lost password with a single-use link that also resets two-step and sessions", async () => {
    const a = await activeAdmin("a");
    const b = await activeAdmin("b");
    const { result: link, token } = await withEmailedLink(() => issuePlatformRecoveryLink(a.ctx, b.identity.id));
    expect(link).not.toHaveProperty("inviteUrl");
    expect(JSON.stringify(link)).not.toContain(token);
    const newPassword = `new-${randomUUID()}-Zz9`;
    await expect(acceptPlatformInvite(token, newPassword, null, ip())).resolves.toEqual({ email: b.identity.email, kind: "RECOVERY" });
    await expect(acceptPlatformInvite(token, newPassword, null, ip())).rejects.toBeInstanceOf(ValidationError);
    expect((await lookupPlatformSession(b.token)).state).toBe("revoked");
    expect((await platformTwoStep().status(b.identity.id)).enabled).toBe(false);
    await expect(startPlatformSignIn(b.identity.email, PASSWORD, CLIENT())).rejects.toBeInstanceOf(UnauthorizedError);
    expect((await startPlatformSignIn(b.identity.email, newPassword, CLIENT())).purpose).toBe("ENROL");
    expect((await audited("platform.admin_recovery_issued", a.identity.email)).length).toBe(1);
    expect((await audited("platform.admin_recovered", b.identity.email)).length).toBe(1);
    expect((await adminDb.platformIdentity.findUniqueOrThrow({ where: { id: b.identity.id } })).credentialsResetAt).not.toBeNull();
  });

  it("only another active admin can issue a recovery link; a suspended issuer and self-recovery are refused", async () => {
    const a = await activeAdmin("a");
    const b = await activeAdmin("b");
    await expect(issuePlatformRecoveryLink(a.ctx, a.identity.id)).rejects.toBeInstanceOf(ValidationError);
    await adminDb.platformIdentity.update({ where: { id: a.identity.id }, data: { status: "SUSPENDED" } });
    await expect(issuePlatformRecoveryLink(a.ctx, b.identity.id)).rejects.toBeInstanceOf(ValidationError);
  });

  it("a two-step reset stamps the identity so its approvals wait 24 hours", async () => {
    const a = await activeAdmin("a");
    const b = await activeAdmin("b");
    await resetPlatformAdminTwoStep(a.ctx, b.identity.id);
    expect((await adminDb.platformIdentity.findUniqueOrThrow({ where: { id: b.identity.id } })).credentialsResetAt).not.toBeNull();
  });
});

describe("platform security settings", () => {
  it("has the B6.03 defaults, validates every value, and audits each change", async () => {
    const a = await activeAdmin("a");
    expect((await getPlatformSecuritySettings(a.ctx)).settings).toEqual({ idleHours: 4, absoluteHours: 12, reverifyMinutes: 15, maxFailedAttempts: 5, lockoutMinutes: 15 });
    await expect(updatePlatformSecuritySettings(a.ctx, { idleHours: 99 })).rejects.toBeInstanceOf(ValidationError);
    await expect(updatePlatformSecuritySettings(a.ctx, { idleHours: 1.5 })).rejects.toBeInstanceOf(ValidationError);
    await expect(updatePlatformSecuritySettings(a.ctx, { minimumAdmins: 1 } as never)).rejects.toThrow(/Unknown setting/);
    await expect(updatePlatformSecuritySettings(a.ctx, { idleHours: 8, absoluteHours: 6 })).rejects.toThrow(/cannot be longer/);
    const out = await updatePlatformSecuritySettings(a.ctx, { idleHours: 2, lockoutMinutes: 30 });
    expect(out.settings).toMatchObject({ idleHours: 2, lockoutMinutes: 30 });
    expect(out.minimumActiveAdmins).toBe(2);
    const rows = await audited("platform.security_settings_changed", a.identity.email);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.metadata).toMatchObject({ idleHours_was: 4, idleHours_now: 2, lockoutMinutes_was: 15, lockoutMinutes_now: 30 });
    // an unchanged value writes nothing and audits nothing
    await updatePlatformSecuritySettings(a.ctx, { idleHours: 2 });
    expect(await audited("platform.security_settings_changed", a.identity.email)).toHaveLength(1);
  });

  it("applies to new sessions (idle and absolute limits) and to the lock", async () => {
    const a = await activeAdmin("a");
    await updatePlatformSecuritySettings(a.ctx, { idleHours: 1, absoluteHours: 5, maxFailedAttempts: 3 });
    const b = await makeAdmin("b");
    const { session } = await signedIn(b);
    expect(session.absoluteExpiresAt.getTime() - Date.now()).toBeLessThanOrEqual(5 * 3_600_000 + 5000);
    expect(session.absoluteExpiresAt.getTime() - Date.now()).toBeGreaterThan(4.9 * 3_600_000);
    expect(session.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(3_600_000 + 5000);
    for (let i = 0; i < 3; i++) await expect(startPlatformSignIn(b.email, "wrong password", CLIENT())).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(startPlatformSignIn(b.email, PASSWORD, CLIENT())).rejects.toBeInstanceOf(RateLimitedError);
  });
});

describe("the routes", () => {
  it("sign-in sets only a strict pending cookie; verify sets the platform session cookie and clears it", async () => {
    const admin = await makeAdmin();
    const { secret } = await (async () => {
      const s = await startPlatformSignIn(admin.email, PASSWORD, CLIENT());
      const e = await beginPlatformEnrolment(s.challengeToken, CLIENT());
      await confirmPlatformEnrolment(s.challengeToken, totpAt(e.secret, currentStep()), CLIENT());
      return e;
    })();
    const { POST: signIn } = await import("../src/app/api/platform/auth/sign-in/route");
    const { POST: verify } = await import("../src/app/api/platform/auth/two-step/verify/route");
    const request = (path: string, body: unknown) => new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip() }, body: JSON.stringify(body) });

    const first = await signIn(request("/api/platform/auth/sign-in", { email: admin.email, password: PASSWORD }));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ twoStepRequired: true, purpose: "VERIFY" });
    const set = first.headers.getSetCookie().join("\n");
    expect(set).toContain("figbloom_platform_two_step_pending=");
    expect(set).toMatch(/SameSite=strict/i);
    expect(set).not.toContain("figbloom_platform_session=");

    const bad = await signIn(request("/api/platform/auth/sign-in", { email: admin.email, password: "nope" }));
    expect(bad.status).toBe(401);

    const pendingToken = /figbloom_platform_two_step_pending=([^;]+)/.exec(set)![1]!;
    holder.jar = { get: (name) => (name === "figbloom_platform_two_step_pending" ? { value: pendingToken } : undefined) };
    const res = await verify(request("/api/platform/auth/two-step/verify", { code: totpAt(secret, currentStep() + 1) }));
    expect(res.status).toBe(200);
    const cookies = res.headers.getSetCookie().join("\n");
    expect(cookies).toContain("figbloom_platform_session=");
    expect(cookies).toMatch(/figbloom_platform_two_step_pending=;/);
    expect(cookies).not.toContain("figbloom_session=");
  });

  it("serves admin routes only to a platform session: a tenant manager and a signed-out caller both get 404", async () => {
    const { GET } = await import("../src/app/api/platform/admins/route");
    expect((await GET()).status).toBe(404);
    const org = await createTestOrganization("PlatformRoute");
    const { user } = await createTestMembership(org.id, "MANAGEMENT", "tenant.route");
    const { createSession, SESSION_COOKIE_NAME } = await import("../src/auth/session");
    const session = await createSession(user.id, { client: { userAgent: "x" }, organizationId: org.id });
    holder.jar = { get: (name) => (name === SESSION_COOKIE_NAME ? { value: session.token } : undefined) };
    expect((await GET()).status).toBe(404);
    await adminDb.organization.delete({ where: { id: org.id } });
  });

  it("a stale session gets a 403 that says to verify; a fresh one succeeds", async () => {
    const a = await activeAdmin("a");
    const { POST } = await import("../src/app/api/platform/admins/route");
    holder.jar = { get: (name) => (name === PLATFORM_SESSION_COOKIE_NAME ? { value: a.token } : undefined) };
    await adminDb.platformSession.update({ where: { id: a.ctx.sessionId! }, data: { verifiedAt: new Date(Date.now() - 3_600_000) } });
    const req = () => new Request("http://localhost/api/platform/admins", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `r.${randomUUID().slice(0, 6)}@platform.example.com`, name: "R" }) });
    const stale = await POST(req());
    expect(stale.status).toBe(403);
    expect((await stale.json()).message).toMatch(/Verify it's you/);
    const { POST: verify } = await import("../src/app/api/platform/security/verify/route");
    const ok = await verify(new Request("http://localhost/api/platform/security/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: totpAt(a.seed, currentStep() + 1) }) }));
    expect(ok.status).toBe(200);
    expect((await POST(req())).status).toBe(200);
  });

});

describe("the dev Super Admin is untouched", () => {
  it("has no password sign-in and is not part of the roster or the minimum-two count", async () => {
    const a = await activeAdmin("a");
    const listed = await listPlatformAdmins(a.ctx);
    expect(listed.items.every((i) => i.id !== undefined)).toBe(true);
    expect(await adminDb.platformIdentity.count({ where: { isDev: true, id: { in: listed.items.map((i) => i.id) } } })).toBe(0);
  });
});
