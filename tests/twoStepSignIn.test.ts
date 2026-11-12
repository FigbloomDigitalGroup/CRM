import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ForbiddenError, NotFoundError, RateLimitedError, UnauthorizedError, ValidationError } from "../src/auth/errors";
import { hashPassword } from "../src/auth/password";
import { lookupSession } from "../src/auth/session";
import { generateBackupCodes, hashBackupCode, normaliseBackupCode } from "../src/auth/twoStep/backupCodes";
import { openSecret, sealSecret } from "../src/auth/twoStep/secretBox";
import { tenantTwoStep } from "../src/auth/twoStep/stores";
import { base32Encode, currentStep, matchTotp, totpAt } from "../src/auth/twoStep/totp";
import { adminDb } from "../src/db/adminClient";
import { unauthenticatedLanding } from "../src/auth/twoStep/pending";
import { login, startSignIn, type TwoStepPending } from "../src/services/authService";
import {
  adminResetMemberTwoStep,
  getTwoStepPolicy,
  isTrustedDevice,
  listTrustedDevices,
  revokeTrustedDevice,
  setTwoStepPolicy,
  disableMyTwoStep,
  regenerateMyBackupCodes,
  beginMyEnrolment,
  confirmMyEnrolment,
} from "../src/services/twoStepService";
import { beginSignInEnrolment, confirmSignInEnrolment, verifySignInCode } from "../src/services/twoStepSignInService";
import { resolveActiveMembership } from "../src/repositories/memberships";
import { createTestMembership, createTestOrganization } from "./helpers/fixtures";

// One trusted proxy in front: the last X-Forwarded-For entry is the client (src/app/api/_lib/clientRequest.ts).
process.env.TRUSTED_PROXY_HOPS = "1";

/**
 * FIG-1134 (B6.02): two-step sign-in for organisation users. Test secrets are
 * generated per run (never real values); the RFC 6238 vectors are the public
 * test vectors from the RFC.
 */

const PASSWORD = "correct horse battery staple";
const holder = vi.hoisted(() => ({ jar: { get: (_n: string): { value: string } | undefined => undefined } }));
vi.mock("next/headers", () => ({ cookies: async () => holder.jar, headers: async () => new Headers() }));

let n = Math.floor(Math.random() * 60000);
const ip = () => `10.${(++n >> 8) & 255}.${Math.floor(n / 250) % 250}.${n % 250}`;
const CLIENT = { userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537.36", place: null };

async function person(roleKey = "MANAGEMENT", organizationId?: string) {
  const org = organizationId ? await adminDb.organization.findUniqueOrThrow({ where: { id: organizationId } }) : await createTestOrganization("TwoStep");
  const { user, membership } = await createTestMembership(org.id, roleKey, "two.step");
  await adminDb.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(PASSWORD) } });
  return { org, user, membership };
}

/** Turns two-step on for a user the way a person would (begin, then a first code) and returns the seed for later codes. */
async function enrol(userId: string) {
  const { secret } = await tenantTwoStep.beginEnrolment(userId, "x@example.test");
  const done = await tenantTwoStep.confirmEnrolment(userId, totpAt(secret, currentStep()));
  expect(done?.backupCodes).toHaveLength(10);
  return { secret, backupCodes: done!.backupCodes };
}
/** A code for the step after the one already used (the enrolment burned the current one). */
const nextCode = (secret: string, ahead = 1) => totpAt(secret, currentStep() + ahead);

async function pending(email: string, extra: { trusted?: string } = {}): Promise<TwoStepPending> {
  const r = await startSignIn(email, PASSWORD, CLIENT.userAgent, ip(), null, extra.trusted);
  if (!("twoStepRequired" in r)) throw new Error("expected a two-step challenge");
  return r;
}

const orgIds: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  holder.jar = { get: () => undefined };
});
afterAll(async () => {
  await adminDb.organization.deleteMany({ where: { id: { in: orgIds } } });
});
// These are V1.1 features: the test organisations run on release V1.1 (the V1 refusal is tested in releaseGateV11.test.ts).
const ORIGINAL_RELEASE = process.env.ACTIVE_RELEASE;
beforeAll(() => {
  process.env.ACTIVE_RELEASE = "v1.1";
});
afterAll(() => {
  if (ORIGINAL_RELEASE === undefined) delete process.env.ACTIVE_RELEASE;
  else process.env.ACTIVE_RELEASE = ORIGINAL_RELEASE;
});
beforeAll(() => {
  vi.stubEnv("LOGIN_RATE_LIMIT_MAX_PER_EMAIL", "1000");
});

describe("the primitives", () => {
  it("matches the RFC 6238 test vectors (SHA-1)", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(totpAt(secret, Math.floor(59 / 30), 8)).toBe("94287082");
    expect(totpAt(secret, Math.floor(1111111109 / 30), 8)).toBe("07081804");
    expect(totpAt(secret, Math.floor(20000000000 / 30), 8)).toBe("65353130");
  });

  it("accepts one step of drift and nothing further", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    const now = 1_700_000_000_000;
    const step = currentStep(now);
    expect(matchTotp(secret, totpAt(secret, step), now)).toBe(step);
    expect(matchTotp(secret, totpAt(secret, step - 1), now)).toBe(step - 1);
    expect(matchTotp(secret, totpAt(secret, step + 1), now)).toBe(step + 1);
    expect(matchTotp(secret, totpAt(secret, step + 3), now)).toBeNull();
    expect(matchTotp(secret, "abcdef", now)).toBeNull();
    expect(matchTotp(secret, "12345", now)).toBeNull();
  });

  it("encrypts seeds (round trip, random nonce, tamper-evident) and hashes backup codes", () => {
    const secret = base32Encode(Buffer.from(randomUUID()));
    const a = sealSecret(secret);
    const b = sealSecret(secret);
    expect(a).not.toBe(b);
    expect(a).not.toContain(secret);
    expect(openSecret(a)).toBe(secret);
    const parts = a.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => openSecret(parts.join("."))).toThrow();
    const [code] = generateBackupCodes(1);
    expect(hashBackupCode(code!)).not.toContain(code!.replace("-", ""));
    expect(normaliseBackupCode(code!.toLowerCase().replace("-", " "))).toBe(code);
    expect(normaliseBackupCode("short")).toBeNull();
  });

  it("fails closed in production without a key", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TWO_STEP_ENCRYPTION_KEY", "");
    expect(() => sealSecret("x")).toThrow(/TWO_STEP_ENCRYPTION_KEY/);
  });
});

describe("what is stored", () => {
  it("never holds a seed or backup code in the clear", async () => {
    const { user } = await person();
    const { secret, backupCodes } = await enrol(user.id);
    const cred = await adminDb.userTwoStep.findUniqueOrThrow({ where: { userId: user.id } });
    expect(cred.secretEncrypted).not.toContain(secret);
    expect(openSecret(cred.secretEncrypted)).toBe(secret);
    const rows = await adminDb.userBackupCode.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(10);
    for (const code of backupCodes) for (const row of rows) expect(row.codeHash).not.toContain(code.replace("-", ""));
  });

  it("is invisible to the tenant application role", async () => {
    const { appDb } = await import("../src/db/orgScopedClient");
    for (const table of ["user_two_step", "user_backup_codes", "user_trusted_devices", "two_step_challenges"]) {
      await expect(appDb.$queryRawUnsafe(`SELECT 1 FROM "${table}" LIMIT 1`)).rejects.toThrow(/permission denied/i);
    }
  });
});

describe("enrolment", () => {
  it("needs a right first code, shows backup codes once, and cannot be restarted while on", async () => {
    const { user } = await person();
    await expect(beginMyEnrolment(user.id, ip())).resolves.toMatchObject({ otpauthUri: expect.stringContaining("otpauth://totp/") });
    await expect(confirmMyEnrolment(user.id, "000000", ip())).rejects.toBeInstanceOf(ValidationError);
    expect((await tenantTwoStep.status(user.id)).enabled).toBe(false);
    const { secret } = await tenantTwoStep.beginEnrolment(user.id, "x@example.test");
    const done = await confirmMyEnrolment(user.id, totpAt(secret, currentStep()), ip());
    expect(done.backupCodes).toHaveLength(10);
    expect(await tenantTwoStep.status(user.id)).toMatchObject({ enabled: true, backupCodesRemaining: 10 });
    await expect(tenantTwoStep.beginEnrolment(user.id, "x@example.test")).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("sign-in with two-step on", () => {
  it("gives no session after the password, and a session after a right code", async () => {
    const { org, user } = await person();
    orgIds.push(org.id);
    const { secret } = await enrol(user.id);
    const sessionsBefore = await adminDb.session.count({ where: { userId: user.id } });

    // the legacy single-step login fails closed for this account
    await expect(login(user.email, PASSWORD, null, ip())).rejects.toBeInstanceOf(UnauthorizedError);
    const challenge = await pending(user.email);
    expect(challenge.purpose).toBe("VERIFY");
    expect(await adminDb.session.count({ where: { userId: user.id } })).toBe(sessionsBefore);

    const done = await verifySignInCode(challenge.challengeToken, nextCode(secret), { ipAddress: ip() });
    expect((await lookupSession(done.token)).state).toBe("active");
    expect(done.organizationSlug).toBe(org.slug);
    // the challenge is single use
    await expect(verifySignInCode(challenge.challengeToken, nextCode(secret, 1), { ipAddress: ip() })).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("refuses a replayed code and an unknown or expired challenge", async () => {
    const { user } = await person();
    const { secret } = await enrol(user.id);
    const code = nextCode(secret);
    const first = await pending(user.email);
    await verifySignInCode(first.challengeToken, code, { ipAddress: ip() });
    const second = await pending(user.email);
    await expect(verifySignInCode(second.challengeToken, code, { ipAddress: ip() })).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(verifySignInCode("not-a-token", nextCode(secret, 1), { ipAddress: ip() })).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(verifySignInCode(undefined, "123456", { ipAddress: ip() })).rejects.toBeInstanceOf(UnauthorizedError);
    const third = await pending(user.email);
    await adminDb.twoStepChallenge.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(verifySignInCode(third.challengeToken, nextCode(secret, 1), { ipAddress: ip() })).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("burns the challenge after five wrong codes, even when the sixth is right, and counts toward the account lockout", async () => {
    vi.stubEnv("TWO_STEP_RATE_LIMIT_MAX_PER_USER", "100");
    vi.stubEnv("TWO_STEP_RATE_LIMIT_MAX_PER_IP", "100");
    vi.stubEnv("LOCKOUT_MAX_FAILURES", "5"); // the default ceiling is 200 since P2-02
    const { user } = await person();
    const { secret } = await enrol(user.id);
    const challenge = await pending(user.email);
    for (let i = 0; i < 5; i++) {
      await expect(verifySignInCode(challenge.challengeToken, "000000", { ipAddress: ip() })).rejects.toThrow(/not right|locked|many/i);
    }
    await expect(verifySignInCode(challenge.challengeToken, nextCode(secret), { ipAddress: ip() })).rejects.toBeInstanceOf(UnauthorizedError);
    const reloaded = await adminDb.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(reloaded.failedSignInCount).toBeGreaterThanOrEqual(5);
    expect(reloaded.lockedUntil).not.toBeNull();
    // locked: even the password step is refused now
    await expect(startSignIn(user.email, PASSWORD, null, ip())).rejects.toBeInstanceOf(RateLimitedError);
    const events = await adminDb.signInEvent.findMany({ where: { userId: user.id, outcome: "LOCKOUT" } });
    expect(events.length).toBeGreaterThan(0);
  });

  it("rate limits the code step per account and per address", async () => {
    vi.stubEnv("TWO_STEP_RATE_LIMIT_MAX_PER_USER", "3");
    const { user } = await person();
    await enrol(user.id);
    const challenge = await pending(user.email);
    const outcomes: string[] = [];
    for (let i = 0; i < 5; i++) {
      try {
        await verifySignInCode(challenge.challengeToken, "000000", { ipAddress: ip() });
      } catch (e) {
        outcomes.push((e as Error).constructor.name);
      }
    }
    expect(outcomes.slice(0, 3)).toEqual(["UnauthorizedError", "UnauthorizedError", "UnauthorizedError"]);
    expect(outcomes.slice(3)).toEqual(["RateLimitedError", "RateLimitedError"]);

    vi.stubEnv("TWO_STEP_RATE_LIMIT_MAX_PER_USER", "100");
    vi.stubEnv("TWO_STEP_RATE_LIMIT_MAX_PER_IP", "2");
    const { user: other } = await person();
    await enrol(other.id);
    const sameIp = ip();
    const c2 = await pending(other.email);
    await expect(verifySignInCode(c2.challengeToken, "000000", { ipAddress: sameIp })).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(verifySignInCode(c2.challengeToken, "000000", { ipAddress: sameIp })).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(verifySignInCode(c2.challengeToken, "000000", { ipAddress: sameIp })).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("accepts each backup code once, tells the person, and counts what is left", async () => {
    const { user } = await person();
    const { backupCodes } = await enrol(user.id);
    const c1 = await pending(user.email);
    const done = await verifySignInCode(c1.challengeToken, backupCodes[0]!.toLowerCase(), { ipAddress: ip() });
    expect(done.backupCodesRemaining).toBe(9);
    const c2 = await pending(user.email);
    await expect(verifySignInCode(c2.challengeToken, backupCodes[0]!, { ipAddress: ip() })).rejects.toBeInstanceOf(UnauthorizedError);
    const audit = await adminDb.auditEvent.findMany({ where: { entityId: user.id, action: "auth.two_step.backup_code_used" } });
    expect(audit.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toContain(backupCodes[0]!);
  });

  it("trusts a device only when asked, skips the code there, and stops when it is revoked or expires", async () => {
    const { user } = await person();
    const { secret } = await enrol(user.id);
    const c1 = await pending(user.email);
    const done = await verifySignInCode(c1.challengeToken, nextCode(secret), { remember: true, ipAddress: ip() });
    expect(done.trustedDevice).not.toBeNull();
    const token = done.trustedDevice!.token;
    expect(await adminDb.userTrustedDevice.findMany({ where: { userId: user.id } })).toEqual([expect.objectContaining({ tokenHash: expect.not.stringContaining(token) })]);

    const direct = await startSignIn(user.email, PASSWORD, CLIENT.userAgent, ip(), null, token);
    expect("twoStepRequired" in direct).toBe(false);
    // a trusted token of someone else does nothing
    const { user: other } = await person();
    await enrol(other.id);
    const stillAsked = await startSignIn(other.email, PASSWORD, CLIENT.userAgent, ip(), null, token);
    expect("twoStepRequired" in stillAsked).toBe(true);

    const [device] = await listTrustedDevices(user.id);
    await revokeTrustedDevice(user.id, device!.id);
    expect(await isTrustedDevice(user.id, token)).toBe(false);
    await expect(revokeTrustedDevice(other.id, device!.id)).rejects.toBeInstanceOf(NotFoundError);
    const afterRevoke = await startSignIn(user.email, PASSWORD, CLIENT.userAgent, ip(), null, token);
    expect("twoStepRequired" in afterRevoke).toBe(true);
  });

  it("does not trust a device by default", async () => {
    const { user } = await person();
    const { secret } = await enrol(user.id);
    const c = await pending(user.email);
    const done = await verifySignInCode(c.challengeToken, nextCode(secret), { ipAddress: ip() });
    expect(done.trustedDevice).toBeNull();
    expect(await adminDb.userTrustedDevice.count({ where: { userId: user.id } })).toBe(0);
  });

  it("tells an account with two-step when a new device signs in (a backup code is used for the second device: the first sign-in burned the usable time steps)", async () => {
    const { user } = await person();
    const { secret, backupCodes } = await enrol(user.id);
    await verifySignInCode((await pending(user.email)).challengeToken, nextCode(secret, 1), { ipAddress: ip() });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const c = await startSignIn(user.email, PASSWORD, "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Firefox/121.0", ip());
      if (!("twoStepRequired" in c)) throw new Error("expected challenge");
      await verifySignInCode(c.challengeToken, backupCodes[1]!, { ipAddress: ip() });
      const printed = log.mock.calls.map((call) => String(call[1] ?? call[0])).join(" | ");
      expect(printed).toContain("device we have not seen before");
      expect(printed).toContain("backup code was used");
    } finally {
      log.mockRestore();
    }
    expect(await adminDb.signInEvent.count({ where: { userId: user.id, outcome: "NEW_DEVICE" } })).toBeGreaterThan(0);
  });
});

describe("a password-only account is untouched", () => {
  it("still signs in with one step and has no challenge", async () => {
    const { user } = await person();
    const r = await startSignIn(user.email, PASSWORD, CLIENT.userAgent, ip());
    expect("twoStepRequired" in r).toBe(false);
    const legacy = await login(user.email, PASSWORD, CLIENT.userAgent, ip());
    expect((await lookupSession(legacy.token)).state).toBe("active");
    expect(await adminDb.twoStepChallenge.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe("organisation policy", () => {
  it("makes sign-in enrol first, and issues no session until the enrolment is confirmed", async () => {
    const { org, user, membership } = await person("MANAGEMENT");
    orgIds.push(org.id);
    await enrol(user.id);
    const adminCtx = (await resolveActiveMembership(user.id, org.id))!;
    const { user: member } = await person("SALES", org.id);
    const live = await (await import("../src/auth/session")).createSession(member.id, { client: CLIENT, organizationId: org.id });

    const result = await setTwoStepPolicy(adminCtx, true);
    expect(result).toMatchObject({ required: true, signedOut: 1 });
    expect((await lookupSession(live.token)).state).toBe("revoked");
    expect((await getTwoStepPolicy(adminCtx)).required).toBe(true);
    const audit = await adminDb.auditEvent.findFirst({ where: { organizationId: org.id, action: "security.two_step_policy_changed" } });
    expect(audit?.actorMembershipId).toBe(membership.id);

    const sessions = await adminDb.session.count({ where: { userId: member.id, revokedAt: null } });
    const challenge = await pending(member.email);
    expect(challenge.purpose).toBe("ENROL");
    expect(await adminDb.session.count({ where: { userId: member.id, revokedAt: null } })).toBe(sessions);

    // a code cannot be used before enrolment started, and a wrong one does not finish it
    await expect(confirmSignInEnrolment(challenge.challengeToken, "123456", { ipAddress: ip() })).rejects.toBeInstanceOf(ValidationError);
    const { secret } = await beginSignInEnrolment(challenge.challengeToken, { ipAddress: ip() });
    await expect(confirmSignInEnrolment(challenge.challengeToken, "000000", { ipAddress: ip() })).rejects.toBeInstanceOf(UnauthorizedError);
    const done = await confirmSignInEnrolment(challenge.challengeToken, totpAt(secret, currentStep()), { ipAddress: ip() });
    expect(done.backupCodes).toHaveLength(10);
    expect((await lookupSession(done.token)).state).toBe("active");

    // an ENROL challenge cannot be used as a VERIFY challenge, and the reverse
    const verifyChallenge = await pending(user.email);
    await expect(beginSignInEnrolment(verifyChallenge.challengeToken, { ipAddress: ip() })).rejects.toBeInstanceOf(UnauthorizedError);

  });

  it("cannot be turned on by someone without their own two-step, and needs security.manage", async () => {
    const { org, user } = await person("MANAGEMENT");
    orgIds.push(org.id);
    const ctx = (await resolveActiveMembership(user.id, org.id))!;
    await expect(setTwoStepPolicy(ctx, true)).rejects.toBeInstanceOf(ValidationError);
    const { user: sales } = await person("SALES", org.id);
    const salesCtx = (await resolveActiveMembership(sales.id, org.id))!;
    await expect(setTwoStepPolicy(salesCtx, true)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getTwoStepPolicy(salesCtx)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("does not leak across organisations", async () => {
    const a = await person("MANAGEMENT");
    const b = await person("MANAGEMENT");
    orgIds.push(a.org.id, b.org.id);
    await enrol(a.user.id);
    await setTwoStepPolicy((await resolveActiveMembership(a.user.id, a.org.id))!, true);
    // organisation B is unaffected: its manager still signs in with the password alone
    const r = await startSignIn(b.user.email, PASSWORD, CLIENT.userAgent, ip());
    expect("twoStepRequired" in r).toBe(false);
    expect((await getTwoStepPolicy((await resolveActiveMembership(b.user.id, b.org.id))!)).required).toBe(false);
    // and B's manager cannot reset a member of A
    const { membership: aMember } = await person("SALES", a.org.id);
    await expect(adminResetMemberTwoStep((await resolveActiveMembership(b.user.id, b.org.id))!, aMember.id)).rejects.toBeInstanceOf(NotFoundError);
    // a person in A (with the policy) who also belongs to B is asked to enrol because of A
    const both = await person("SALES", a.org.id);
    const bRole = await adminDb.role.findUniqueOrThrow({ where: { key: "SALES" } });
    await adminDb.membership.create({ data: { organizationId: b.org.id, userId: both.user.id, roleId: bRole.id, joinedAt: new Date() } });
    const r2 = await startSignIn(both.user.email, PASSWORD, CLIENT.userAgent, ip());
    expect("twoStepRequired" in r2 && r2.purpose).toBe("ENROL");
  });
});

describe("own settings and recovery", () => {
  it("turning it off needs the password and a code, and is refused where the organisation requires it", async () => {
    vi.stubEnv("TWO_STEP_RATE_LIMIT_MAX_PER_USER", "100");
    const { org, user } = await person("MANAGEMENT");
    orgIds.push(org.id);
    const { secret } = await enrol(user.id);
    await expect(disableMyTwoStep(user.id, "wrong password!!", nextCode(secret), ip())).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(disableMyTwoStep(user.id, PASSWORD, "000000", ip())).rejects.toBeInstanceOf(UnauthorizedError);
    expect((await tenantTwoStep.status(user.id)).enabled).toBe(true);
    await setTwoStepPolicy((await resolveActiveMembership(user.id, org.id))!, true);
    await expect(disableMyTwoStep(user.id, PASSWORD, nextCode(secret), ip())).rejects.toBeInstanceOf(ForbiddenError);
    await setTwoStepPolicy((await resolveActiveMembership(user.id, org.id))!, false);
    await disableMyTwoStep(user.id, PASSWORD, nextCode(secret), ip());
    expect((await tenantTwoStep.status(user.id)).enabled).toBe(false);
    expect(await adminDb.userBackupCode.count({ where: { userId: user.id } })).toBe(0);
    expect(await adminDb.auditEvent.count({ where: { entityId: user.id, action: "auth.two_step.disabled" } })).toBeGreaterThan(0);
  });

  it("regenerating backup codes retires the old ones", async () => {
    vi.stubEnv("TWO_STEP_RATE_LIMIT_MAX_PER_USER", "100");
    const { user } = await person();
    const { secret, backupCodes } = await enrol(user.id);
    const fresh = await regenerateMyBackupCodes(user.id, PASSWORD, nextCode(secret), ip());
    expect(fresh).toHaveLength(10);
    expect(await tenantTwoStep.useBackupCode(user.id, backupCodes[0]!)).toBeNull();
    expect(await tenantTwoStep.useBackupCode(user.id, fresh[0]!)).toEqual({ remaining: 9 });
  });

  it("an administrator can reset a member (audited, sessions ended) but not a member of other organisations, nor without membership.manage", async () => {
    const admin = await person("MANAGEMENT");
    orgIds.push(admin.org.id);
    const adminCtx = (await resolveActiveMembership(admin.user.id, admin.org.id))!;
    const target = await person("SALES", admin.org.id);
    await enrol(target.user.id);
    const live = await (await import("../src/auth/session")).createSession(target.user.id, { client: CLIENT, organizationId: admin.org.id });

    await adminResetMemberTwoStep(adminCtx, target.membership.id);
    expect((await tenantTwoStep.status(target.user.id)).enabled).toBe(false);
    expect((await lookupSession(live.token)).state).toBe("revoked");
    const audit = await adminDb.auditEvent.findFirst({ where: { organizationId: admin.org.id, action: "security.two_step_reset", entityId: target.membership.id } });
    expect(audit?.actorMembershipId).toBe(admin.membership.id);

    await expect(adminResetMemberTwoStep(adminCtx, admin.membership.id)).rejects.toBeInstanceOf(ValidationError);
    const salesCtx = (await resolveActiveMembership(target.user.id, admin.org.id))!;
    await expect(adminResetMemberTwoStep(salesCtx, admin.membership.id)).rejects.toBeInstanceOf(ForbiddenError);

    const shared = await person("SALES", admin.org.id);
    const other = await createTestOrganization("Other");
    orgIds.push(other.id);
    const role = await adminDb.role.findUniqueOrThrow({ where: { key: "SALES" } });
    await adminDb.membership.create({ data: { organizationId: other.id, userId: shared.user.id, roleId: role.id, joinedAt: new Date() } });
    await expect(adminResetMemberTwoStep(adminCtx, shared.membership.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("the hand-off from the frozen login page", () => {
  it("answers the login POST with the same shape, a pending cookie and no session cookie", async () => {
    const { org, user } = await person();
    orgIds.push(org.id);
    const { POST } = await import("../src/app/api/auth/login/route");
    await enrol(user.id);
    const res = await POST(new Request("http://localhost/api/auth/login", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip() }, body: JSON.stringify({ email: user.email, password: PASSWORD }) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ organizationSlug: org.slug, twoStepRequired: true, twoStepPurpose: "VERIFY", twoStepUrl: "/two-step" });
    const cookies = res.headers.getSetCookie().join("\n");
    expect(cookies).toContain("figbloom_two_step_pending=");
    expect(cookies).not.toContain("figbloom_session=");
    expect(JSON.stringify(body)).not.toMatch(/token/i);
  });

  it("completes through the verify route: session cookie set, pending cleared", async () => {
    const { org, user } = await person();
    orgIds.push(org.id);
    const { secret } = await enrol(user.id);
    const { POST: login } = await import("../src/app/api/auth/login/route");
    const { POST: verify } = await import("../src/app/api/auth/two-step/verify/route");
    const first = await login(new Request("http://localhost/api/auth/login", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip() }, body: JSON.stringify({ email: user.email, password: PASSWORD }) }));
    const pendingToken = /figbloom_two_step_pending=([^;]+)/.exec(first.headers.getSetCookie().join("\n"))![1]!;
    holder.jar = { get: (name) => (name === "figbloom_two_step_pending" ? { value: pendingToken } : undefined) };
    const res = await verify(new Request("http://localhost/api/auth/two-step/verify", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip() }, body: JSON.stringify({ code: nextCode(secret), rememberDevice: true }) }));
    expect(res.status).toBe(200);
    const set = res.headers.getSetCookie().join("\n");
    expect(set).toContain("figbloom_session=");
    expect(set).toContain("figbloom_trusted_device=");
    expect(set).toMatch(/figbloom_two_step_pending=;/);
    const bad = await verify(new Request("http://localhost/api/auth/two-step/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "" }) }));
    expect(bad.status).toBe(400);
  });

  it("sends an unauthenticated /o visit to /two-step only while a pending cookie exists (the /o layout uses this)", () => {
    const jar = (v: Record<string, string>) => ({ get: (n: string) => (n in v ? { value: v[n]! } : undefined) });
    expect(unauthenticatedLanding(jar({ figbloom_two_step_pending: "abc" }))).toBe("/two-step");
    expect(unauthenticatedLanding(jar({}))).toBe("/login");
    expect(unauthenticatedLanding(jar({ figbloom_platform_two_step_pending: "abc" }))).toBe("/login");
  });
});

describe("security review fixes", () => {
  async function invite(orgId: string, email: string) {
    const mgmt = await (await import("./helpers/fixtures")).createTestContext(orgId, "MANAGEMENT");
    const membershipService = await import("../src/services/membershipService");
    let token = "";
    await membershipService.inviteMember(mgmt, { email, name: "Invitee", roleKey: "SALES" }, (t) => ((token = t), t));
    return token;
  }

  it("an invite link does not bypass the invitee's own two-step", async () => {
    const { user } = await person();
    await enrol(user.id);
    const org = await createTestOrganization("InviteTwoStep");
    orgIds.push(org.id);
    const token = await invite(org.id, user.email);
    const before = await adminDb.session.count({ where: { userId: user.id } });
    const { acceptMembershipInvite } = await import("../src/services/authService");
    const result = await acceptMembershipInvite(token, undefined, CLIENT.userAgent, ip());
    expect(result).toMatchObject({ twoStepRequired: true, purpose: "VERIFY", userId: user.id });
    expect("token" in result).toBe(false);
    expect(await adminDb.session.count({ where: { userId: user.id } })).toBe(before);
  });

  it("an invite into an organisation that enforces two-step goes to enrolment, for existing and new users", async () => {
    const { org, user } = await person("MANAGEMENT");
    orgIds.push(org.id);
    await enrol(user.id);
    await setTwoStepPolicy((await resolveActiveMembership(user.id, org.id))!, true);
    const { acceptMembershipInvite } = await import("../src/services/authService");

    const fresh = `new.${randomUUID().slice(0, 8)}@example.test`;
    const tokenNew = await invite(org.id, fresh);
    const r1 = await acceptMembershipInvite(tokenNew, "a-fine-password-123", CLIENT.userAgent, ip());
    expect(r1).toMatchObject({ twoStepRequired: true, purpose: "ENROL" });
    const newUser = await adminDb.user.findUniqueOrThrow({ where: { email: fresh } });
    expect(await adminDb.session.count({ where: { userId: newUser.id } })).toBe(0);

    const { user: other } = await person();
    const tokenOld = await invite(org.id, other.email);
    const r2 = await acceptMembershipInvite(tokenOld, undefined, CLIENT.userAgent, ip());
    expect(r2).toMatchObject({ twoStepRequired: true, purpose: "ENROL" });
  });

  it("an invite for a user without two-step or policy still signs in (same shape as before)", async () => {
    const { user } = await person();
    const org = await createTestOrganization("InvitePlain");
    orgIds.push(org.id);
    const token = await invite(org.id, user.email);
    const { acceptMembershipInvite } = await import("../src/services/authService");
    const r = await acceptMembershipInvite(token, undefined, CLIENT.userAgent, ip());
    expect(r).toMatchObject({ userId: user.id, organizationSlug: org.slug });
    expect("token" in r).toBe(true);
  });

  it("the failure counter is not reset by a right password while the second step is owed, and increments atomically", async () => {
    const { user } = await person();
    await enrol(user.id);
    await adminDb.user.update({ where: { id: user.id }, data: { failedSignInCount: 3 } });
    await pending(user.email);
    expect((await adminDb.user.findUniqueOrThrow({ where: { id: user.id } })).failedSignInCount).toBe(3);

    const { incrementFailedSignIn } = await import("../src/services/authService");
    await adminDb.user.update({ where: { id: user.id }, data: { failedSignInCount: 0, lockedUntil: null } });
    await Promise.all(Array.from({ length: 4 }, () => incrementFailedSignIn(user.id)));
    expect((await adminDb.user.findUniqueOrThrow({ where: { id: user.id } })).failedSignInCount).toBe(4);
  });

  it("parallel wrong codes cannot get past the five-attempt cap", async () => {
    vi.stubEnv("TWO_STEP_RATE_LIMIT_MAX_PER_USER", "1000");
    vi.stubEnv("TWO_STEP_RATE_LIMIT_MAX_PER_IP", "1000");
    const { user } = await person();
    await enrol(user.id);
    const challenge = await pending(user.email);
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => verifySignInCode(challenge.challengeToken, "000000", { ipAddress: ip() })),
    );
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect((await adminDb.user.findUniqueOrThrow({ where: { id: user.id } })).failedSignInCount).toBeLessThanOrEqual(5);
  });

  it("a password reset revokes trusted devices", async () => {
    const { user } = await person();
    const { trustThisDevice } = await import("../src/services/twoStepService");
    await trustThisDevice(user.id, { userAgent: CLIENT.userAgent, ipAddress: ip() });
    expect(await listTrustedDevices(user.id)).toHaveLength(1);
    const { requestPasswordReset, resetPassword } = await import("../src/services/authService");
    let token = "";
    await requestPasswordReset(user.email, (t) => ((token = t), t), ip());
    await resetPassword(token, "another-new-password-56");
    expect(await listTrustedDevices(user.id)).toHaveLength(0);
  });

  it("has row-level security enabled and forced on the tenant two-step tables, and figbloom_app sees no row even when re-granted", async () => {
    const { appDb } = await import("../src/db/orgScopedClient");
    const tables = ["user_two_step", "user_backup_codes", "user_trusted_devices", "two_step_challenges"];
    const rows = await adminDb.$queryRaw<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
      SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY(${tables}) AND relkind = 'r'`;
    expect(rows).toHaveLength(4);
    for (const r of rows) expect([r.relname, r.relrowsecurity, r.relforcerowsecurity]).toEqual([r.relname, true, true]);
    await adminDb.$executeRawUnsafe(`GRANT SELECT ON "user_two_step" TO figbloom_app`);
    try {
      const { user } = await person();
      await enrol(user.id);
      const seen = await appDb.$queryRawUnsafe<unknown[]>(`SELECT 1 FROM "user_two_step"`);
      expect(seen).toHaveLength(0);
    } finally {
      await adminDb.$executeRawUnsafe(`REVOKE ALL ON "user_two_step" FROM figbloom_app`);
    }
  });
});
