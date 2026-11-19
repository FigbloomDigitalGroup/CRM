import { Prisma } from "@prisma/client";
import { deliverOrLog } from "../auth/email";
import { ValidationError } from "../auth/errors";
import { createSession } from "../auth/session";
import type { ClientInfo } from "../auth/deviceInfo";
import { confirmEmailToken } from "../auth/figbloom/emailConfirm";
import { FigbloomSignInError, type FigbloomIdentity } from "../auth/figbloom/oidc";
import { PlatformError, platformClient } from "../auth/figbloom/platformClient";
import { CONFIRM_EMAIL_PATH, figbloomSettings } from "../auth/figbloom/settings";
import { adminDb } from "../db/adminClient";
import { getAccessState } from "./accessStateService";
import { recordAuthAuditEvent } from "./authAudit";
import { recordSignInEvent } from "./signInEventService";

/**
 * Figbloom sign-in inside CRM (ERP/CRM_COGNITO_CONTRACT.md section 2): after Figbloom's sign-in page proved who the
 * person is, CRM finds or creates its own User and issues its own session exactly as a password sign-in does. And when
 * CRM's sign-up or an invitation needs a new Figbloom account, CRM asks the platform to create it with the password
 * typed into CRM's (unchanged) form. CRM never stores that password.
 */

const byEmail = (email: string) => ({ email: { equals: email.trim(), mode: "insensitive" as const } });

/** The CRM user behind a Figbloom identity: linked, linked now by verified email, or created with no organisation. */
async function userFor(identity: FigbloomIdentity) {
  const linked = await adminDb.user.findUnique({ where: { identitySub: identity.sub } });
  if (linked) return linked;
  if (!identity.email) {
    throw new FigbloomSignInError("no_email", "Your Figbloom account has no email address, so CRM can't find you.");
  }
  const sameEmail = await adminDb.user.findFirst({ where: byEmail(identity.email) });
  if (sameEmail) {
    // only a proven inbox links an existing CRM user, and never one already linked to another Figbloom account
    if (!identity.emailVerified || sameEmail.identitySub) {
      throw new FigbloomSignInError(
        "sign_in_failed",
        "This email already has a CRM account. Open the link in your CRM invitation, or confirm your email first.",
      );
    }
    return adminDb.user.update({ where: { id: sameEmail.id }, data: { identitySub: identity.sub } });
  }
  // a Figbloom account from another product: welcome, with no organisation yet ("awaiting access", as sign-up gives)
  try {
    return await adminDb.user.create({
      data: { email: identity.email, name: identity.name ?? identity.email.split("@")[0], identitySub: identity.sub },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // created by a sign-in running at the same moment
      const again = await adminDb.user.findUnique({ where: { identitySub: identity.sub } });
      if (again) return again;
    }
    throw err;
  }
}

/** A verified Figbloom identity -> CRM's own session (the same events and audit as a password sign-in). */
export async function signInWithFigbloom(
  identity: FigbloomIdentity,
  client: ClientInfo,
): Promise<{ token: string; expiresAt: Date; userId: string; organizationSlug: string | null; awaitingAccess: boolean }> {
  const user = await userFor(identity);
  if (user.status !== "ACTIVE") {
    await recordSignInEvent({ userId: user.id, email: user.email, outcome: "FAILURE", reason: "ACCOUNT_INACTIVE", client });
    throw new FigbloomSignInError("account_inactive", "This CRM account is not active. Ask your organisation's Management users.");
  }
  const access = await getAccessState(user.id);
  if (access.state === "deactivated") {
    await recordSignInEvent({ userId: user.id, email: user.email, outcome: "FAILURE", reason: "DEACTIVATED", client });
    throw new FigbloomSignInError("account_deactivated", "Your access to CRM has been turned off by your organisation.");
  }

  const session = await createSession(user.id, { client });
  await recordSignInEvent({
    userId: user.id,
    email: user.email,
    outcome: "SUCCESS",
    reason: "FIGBLOOM",
    sessionId: session.sessionId,
    deviceLabel: session.deviceLabel,
    client,
  });
  if (session.isNewDevice) {
    await recordSignInEvent({
      userId: user.id,
      email: user.email,
      outcome: "NEW_DEVICE",
      sessionId: session.sessionId,
      deviceLabel: session.deviceLabel,
      client,
    });
  }
  await recordAuthAuditEvent(user.id, "auth.login", { via: "figbloom" });
  return {
    token: session.token,
    expiresAt: session.expiresAt,
    userId: user.id,
    organizationSlug: access.organizations[0]?.slug ?? null,
    awaitingAccess: access.awaitingAccess,
  };
}

/**
 * The person's Figbloom account, created with this password unless it already exists (then the password is ignored
 * and `created` is false). The pool's password rule refuses as a ValidationError carrying the rule, so CRM's form
 * shows it.
 */
export async function ensureFigbloomAccount(input: {
  email: string;
  name: string;
  password: string;
  emailProven: boolean;
}): Promise<{ sub: string; created: boolean }> {
  try {
    const { user_sub, created } = await platformClient().createUser(input);
    return { sub: user_sub, created };
  } catch (err) {
    if (err instanceof PlatformError && err.code === "invalid_password") {
      throw new ValidationError(err.message, [{ path: "password", message: err.message }]);
    }
    throw err;
  }
}

/** The welcome email after a Figbloom sign-up, with the "Confirm your email" link. */
export async function sendFigbloomConfirmEmail(user: { id: string; email: string; identitySub: string }): Promise<void> {
  const settings = figbloomSettings();
  const link = `${settings.appBaseUrl}${CONFIRM_EMAIL_PATH}?token=${encodeURIComponent(confirmEmailToken(user, settings.clientSecret))}`;
  await deliverOrLog("figbloom-confirm-email", {
    to: user.email,
    subject: "Confirm your email for Figbloom CRM",
    text:
      `Welcome to Figbloom CRM. You sign in with your Figbloom account.\n\n` +
      `Please confirm your email address, so you can reset your password if you ever forget it:\n\n${link}\n\n` +
      `The link works for 14 days.`,
    html:
      `<p>Welcome to Figbloom CRM. You sign in with your Figbloom account.</p>` +
      `<p>Please confirm your email address, so you can reset your password if you ever forget it:</p>` +
      `<p><a href="${link}">Confirm your email</a></p><p>The link works for 14 days.</p>`,
  });
}

/** The "Confirm your email" link was opened: the platform marks the Figbloom account's email verified. */
export async function confirmFigbloomEmail(proof: { uid: string; sub: string }): Promise<boolean> {
  const user = await adminDb.user.findUnique({ where: { id: proof.uid }, select: { identitySub: true } });
  if (!user || user.identitySub !== proof.sub) return false;
  await platformClient().markEmailVerified(proof.sub);
  return true;
}
