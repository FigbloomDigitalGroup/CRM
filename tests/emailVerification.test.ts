import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ValidationError } from "../src/auth/errors";
import { inviteUrlFor } from "../src/auth/inviteLinks";
import { hashPassword } from "../src/auth/password";
import { resolveSessionUserId } from "../src/auth/session";
import { adminDb } from "../src/db/adminClient";
import * as authService from "../src/services/authService";
import * as membershipService from "../src/services/membershipService";
import { sendMembershipInviteEmail } from "../src/auth/email";
import { createTestContext, createTestMembership, createTestOrganization } from "./helpers/fixtures";

// Capture the invite email instead of sending it, so the link inside can be checked.
vi.mock("../src/auth/email", async (original) => ({
  ...(await original<typeof import("../src/auth/email")>()),
  sendMembershipInviteEmail: vi.fn(async () => undefined),
}));

/**
 * UC-F2 (FIG-1766, audit S-3): email ownership. Public signup makes an UNVERIFIED account; accepting an invite proves
 * the mailbox, so an account that was pre-registered by someone else must not keep that person's password, sessions
 * or second step when the real owner accepts. The frozen accept-invite page is not changed: an unproved account is sent
 * to the new /invite/verify route (by the invite email, or by the coded refusal the accept API gives).
 */
const ATTACKER_PASSWORD = "attacker-chosen-password-1";
const VICTIM_PASSWORD = "victim-chosen-password-1";
const LINK = (token: string) => `https://crm.example/accept-invite?token=${token}`;

function uniqueEmail(prefix: string): string {
  return `${prefix}.${randomUUID().slice(0, 8)}@example.test`;
}
function uniqueIp(): string {
  return `198.51.100.${randomUUID().slice(0, 4)}-${randomUUID().slice(0, 4)}`;
}

async function inviteAndCaptureToken(orgId: string, email: string, roleKey = "SALES"): Promise<string> {
  const management = await createTestContext(orgId, "MANAGEMENT");
  let token = "";
  await membershipService.inviteMember(management, { email, name: "Invited Person", roleKey }, (t) => ((token = t), t));
  return token;
}

describe("S-3: a pre-registered account cannot take over an invited seat", () => {
  it("the attacker's password does not work after the real owner accepts the invite", async () => {
    const org = await createTestOrganization();
    const email = uniqueEmail("victim");

    // 1. The attacker signs up with the victim's address first, and keeps a live session.
    const attacker = await authService.signup(email, ATTACKER_PASSWORD, "Attacker", null, uniqueIp());
    expect(await resolveSessionUserId(attacker.token)).toBe(attacker.userId);

    // 2. The organisation invites that address; the real owner of the mailbox opens the link and chooses a password.
    const token = await inviteAndCaptureToken(org.id, email);
    const accepted = await authService.acceptMembershipInvite(token, VICTIM_PASSWORD, null, uniqueIp());
    expect(accepted.userId).toBe(attacker.userId);

    // 3. The seat now belongs to the person who proved the mailbox, not to the pre-registrant.
    await expect(authService.login(email, ATTACKER_PASSWORD, null, uniqueIp())).rejects.toThrow();
    const signedIn = await authService.login(email, VICTIM_PASSWORD, null, uniqueIp());
    expect(signedIn.userId).toBe(attacker.userId);

    // 4. The attacker's earlier session is dead too.
    expect(await resolveSessionUserId(attacker.token)).toBeNull();
  });

  it("the attacker's password alone can never accept the invite", async () => {
    const org = await createTestOrganization();
    const email = uniqueEmail("victim");
    await authService.signup(email, ATTACKER_PASSWORD, "Attacker", null, uniqueIp());
    const token = await inviteAndCaptureToken(org.id, email);
    // Without a fresh password the accept is refused; the old password is never used to activate the seat.
    await expect(authService.acceptMembershipInvite(token, undefined, null, uniqueIp())).rejects.toBeInstanceOf(ValidationError);
    const user = await adminDb.user.findUniqueOrThrow({ where: { email } });
    expect(await adminDb.membership.count({ where: { userId: user.id, status: "ACTIVE" } })).toBe(0);
  });

  it("the frozen accept-invite page is served exactly as before: it still asks for a password only when the account has none", async () => {
    const org = await createTestOrganization();
    const email = uniqueEmail("victim");
    await authService.signup(email, ATTACKER_PASSWORD, "Attacker", null, uniqueIp());
    const token = await inviteAndCaptureToken(org.id, email);
    // Baseline rule, unchanged: requiresPassword is "no password yet". The account has one (the pre-registrant's), so false.
    expect((await authService.getInviteInfo(token)).requiresPassword).toBe(false);
    // The new verify route is what tells an unproved account to choose a fresh password.
    expect(await authService.getInviteVerification(token)).toEqual({ email, needsPassword: true });
  });

  it("the old page's submit (no password) is refused with a coded error that names the verify route, and burns nothing", async () => {
    const org = await createTestOrganization();
    const email = uniqueEmail("victim");
    await authService.signup(email, ATTACKER_PASSWORD, "Attacker", null, uniqueIp());
    const token = await inviteAndCaptureToken(org.id, email);

    const refusal = await authService.acceptMembershipInvite(token, undefined, null, uniqueIp()).catch((e) => e);
    expect(refusal).toBeInstanceOf(ValidationError);
    expect(refusal).toBeInstanceOf(authService.InviteEmailNotVerifiedError);
    expect(refusal.issues?.[0]?.code).toBe("EMAIL_NOT_VERIFIED");
    expect(refusal.message).toContain(`/invite/verify?token=${encodeURIComponent(token)}`);
    // The link still works afterwards: validation happens before the single-use token is consumed.
    const accepted = await authService.acceptMembershipInvite(token, VICTIM_PASSWORD, null, uniqueIp());
    expect(accepted.organizationSlug).toBe(org.slug);
  });

  it("a weak fresh password on the verify step is refused before the link is used", async () => {
    const org = await createTestOrganization();
    const email = uniqueEmail("victim");
    await authService.signup(email, ATTACKER_PASSWORD, "Attacker", null, uniqueIp());
    const token = await inviteAndCaptureToken(org.id, email);
    await expect(authService.acceptMembershipInvite(token, "short", null, uniqueIp())).rejects.toBeInstanceOf(ValidationError);
    expect((await authService.acceptMembershipInvite(token, VICTIM_PASSWORD, null, uniqueIp())).organizationSlug).toBe(org.slug);
  });

  it("the invite email for an unproved account links to the verify route; everyone else keeps the ordinary link", async () => {
    const orgA = await createTestOrganization();
    const orgB = await createTestOrganization();
    const sent = vi.mocked(sendMembershipInviteEmail);
    const mgmtA = await createTestContext(orgA.id, "MANAGEMENT");

    const unproved = uniqueEmail("victim");
    await authService.signup(unproved, ATTACKER_PASSWORD, "Attacker", null, uniqueIp());
    await membershipService.inviteMember(mgmtA, { email: unproved, name: "Invited", roleKey: "SALES" }, LINK);
    expect(sent.mock.calls.at(-1)?.[1]).toMatch(/^https:\/\/crm\.example\/invite\/verify\?token=/);

    await membershipService.inviteMember(mgmtA, { email: uniqueEmail("fresh"), name: "Fresh", roleKey: "SALES" }, LINK);
    expect(sent.mock.calls.at(-1)?.[1]).toMatch(/^https:\/\/crm\.example\/accept-invite\?token=/);

    const { user: proved } = await createTestMembership(orgB.id, "SALES");
    await adminDb.user.update({ where: { id: proved.id }, data: { passwordHash: await hashPassword(VICTIM_PASSWORD) } });
    await membershipService.inviteMember(mgmtA, { email: proved.email, name: "Proved", roleKey: "DELIVERY" }, LINK);
    expect(sent.mock.calls.at(-1)?.[1]).toMatch(/^https:\/\/crm\.example\/accept-invite\?token=/);
  });

  it("removes a second step the pre-registrant enrolled", async () => {
    const org = await createTestOrganization();
    const email = uniqueEmail("victim");
    const attacker = await authService.signup(email, ATTACKER_PASSWORD, "Attacker", null, uniqueIp());
    await adminDb.userTwoStep.create({ data: { userId: attacker.userId, secretEncrypted: "x", enabledAt: new Date() } });

    const token = await inviteAndCaptureToken(org.id, email);
    await authService.acceptMembershipInvite(token, VICTIM_PASSWORD, null, uniqueIp());

    expect(await adminDb.userTwoStep.count({ where: { userId: attacker.userId } })).toBe(0);
  });

  it("signup creates an account that is not verified, and signup alone grants no organisation access", async () => {
    const email = uniqueEmail("newcomer");
    const created = await authService.signup(email, ATTACKER_PASSWORD, "Newcomer", null, uniqueIp());
    const user = await adminDb.user.findUniqueOrThrow({ where: { id: created.userId } });
    expect(user.emailVerifiedAt).toBeNull();
    expect(await adminDb.membership.count({ where: { userId: created.userId } })).toBe(0);
    expect(created.access.awaitingAccess).toBe(true);
  });
});

describe("accepting an invite proves the mailbox", () => {
  it("a brand-new invitee sets a password through the ordinary page and becomes verified", async () => {
    const org = await createTestOrganization();
    const email = uniqueEmail("fresh");
    const token = await inviteAndCaptureToken(org.id, email);
    expect((await authService.getInviteInfo(token)).requiresPassword).toBe(true);
    const accepted = await authService.acceptMembershipInvite(token, VICTIM_PASSWORD, null, uniqueIp());
    const user = await adminDb.user.findUniqueOrThrow({ where: { id: accepted.userId } });
    expect(user.emailVerifiedAt).not.toBeNull();
    expect((await authService.login(email, VICTIM_PASSWORD, null, uniqueIp())).userId).toBe(accepted.userId);
  });

  it("an already-verified account keeps its own password and sessions when it accepts a second invite", async () => {
    const orgA = await createTestOrganization();
    const orgB = await createTestOrganization();
    const { user } = await createTestMembership(orgA.id, "SALES");
    await adminDb.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date(), passwordHash: await hashPassword(VICTIM_PASSWORD) } });
    const before = await adminDb.user.findUniqueOrThrow({ where: { id: user.id } });

    const token = await inviteAndCaptureToken(orgB.id, user.email, "DELIVERY");
    expect((await authService.getInviteInfo(token)).requiresPassword).toBe(false);
    expect((await authService.getInviteVerification(token)).needsPassword).toBe(false);
    const accepted = await authService.acceptMembershipInvite(token, undefined, null, uniqueIp());
    expect(accepted.userId).toBe(user.id);
    const after = await adminDb.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.passwordHash).toBe(before.passwordHash);
  });
});

describe("a password reset proves the mailbox", () => {
  it("completing a reset marks an unverified account verified", async () => {
    const email = uniqueEmail("resetter");
    const created = await authService.signup(email, ATTACKER_PASSWORD, "Resetter", null, uniqueIp());
    let resetToken = "";
    await authService.requestPasswordReset(email, (t) => ((resetToken = t), t), uniqueIp());
    await authService.resetPassword(resetToken, "a-brand-new-password-1");
    const user = await adminDb.user.findUniqueOrThrow({ where: { id: created.userId } });
    expect(user.emailVerifiedAt).not.toBeNull();
  });
});

describe("inviteUrlFor", () => {
  const link = "https://crm.example/accept-invite?token=abc";
  it("rewrites only for an account with a password nobody proved", () => {
    expect(inviteUrlFor({ passwordHash: "h", emailVerifiedAt: null }, link)).toBe("https://crm.example/invite/verify?token=abc");
    expect(inviteUrlFor({ passwordHash: "h", emailVerifiedAt: new Date() }, link)).toBe(link);
    expect(inviteUrlFor({ passwordHash: null, emailVerifiedAt: null }, link)).toBe(link);
  });
});
