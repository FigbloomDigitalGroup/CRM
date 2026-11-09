import nodemailer from "nodemailer";
import { sendWithResend } from "../integrations/email/resend";

/**
 * Outbound auth email (FIG-592 password reset, FIG-593 membership invites).
 * Sends real mail through SMTP (`SMTP_HOST`) or Resend (`RESEND_API_KEY` + `EMAIL_FROM`), see .env.example;
 * with neither, falls back to logging the message server-side so both flows
 * stay exercisable without credentials. `transportOverride` exists only
 * for tests -- it lets `tests/authEmail.test.ts` verify the composed
 * message without a real SMTP server, the same way `resolveRequestContext`
 * injects a fake cookie reader instead of a real Next.js request.
 */
export interface MailTransport {
  sendMail(message: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<unknown>;
}

function isSmtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST);
}

/**
 * Which provider sends auth and notification mail: SMTP when `SMTP_HOST` is set (it wins, so an existing SMTP setup does
 * not change), otherwise Resend when `RESEND_API_KEY` is set, otherwise none.
 */
export function emailProvider(env: Record<string, string | undefined> = process.env): "smtp" | "resend" | "none" {
  if (env.SMTP_HOST) return "smtp";
  if (env.RESEND_API_KEY?.trim()) return "resend";
  return "none";
}

/**
 * The sender for Resend: `EMAIL_FROM`, else `SMTP_FROM`. Resend refuses an unverified domain, so the local-development
 * default is not offered in production: a missing sender is an error that names the variable.
 */
function resendFrom(): string {
  const from = process.env.EMAIL_FROM?.trim() || process.env.SMTP_FROM?.trim();
  if (from) return from;
  if (process.env.NODE_ENV === "production") {
    throw new Error("EMAIL_FROM is not set: set it to an address on a domain verified in Resend.");
  }
  return "FigBloom CRM <no-reply@figbloom.local>";
}

function createResendTransport(): MailTransport {
  return {
    async sendMail(message) {
      await sendWithResend({ from: message.from, to: [message.to], subject: message.subject, text: message.text, html: message.html });
      return undefined;
    },
  };
}

function createRealTransport(): MailTransport {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" }
      : undefined,
  });
}

/**
 * Exported so other notification senders (FIG-597,
 * `src/notifications/email.ts`) can reuse the exact same SMTP-or-log
 * fallback and transport-override test seam, instead of duplicating it.
 */
export async function deliverOrLog(
  logLabel: string,
  message: { to: string; subject: string; text: string; html: string },
  transportOverride?: MailTransport,
): Promise<void> {
  if (!transportOverride && emailProvider() === "none") {
    if (process.env.NODE_ENV === "production") {
      // Never write links or bodies (reset, invite, recovery tokens) to production logs.
      console.error(
        `[${logLabel}] No email provider configured -- NOT delivered to ${message.to} (subject: ${message.subject})`,
      );
      return;
    }
    console.log(
      `[${logLabel}] No email provider configured -- would send to ${message.to}:\n${message.text}`,
    );
    return;
  }

  const useResend = !transportOverride && !isSmtpConfigured();
  const transport = transportOverride ?? (useResend ? createResendTransport() : createRealTransport());
  await transport.sendMail({
    from: useResend ? resendFrom() : (process.env.SMTP_FROM ?? "FigBloom CRM <no-reply@figbloom.local>"),
    ...message,
  });
}

export async function sendPasswordResetEmail(
  email: string,
  resetUrl: string,
  transportOverride?: MailTransport,
): Promise<void> {
  await deliverOrLog(
    "password-reset",
    {
      to: email,
      subject: "Reset your FigBloom CRM password",
      text: `Use this link to reset your password. It expires in 1 hour and can only be used once.\n\n${resetUrl}`,
      html: `<p>Use this link to reset your password. It expires in 1 hour and can only be used once.</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
    },
    transportOverride,
  );
}

export async function sendMembershipInviteEmail(
  email: string,
  acceptUrl: string,
  transportOverride?: MailTransport,
): Promise<void> {
  await deliverOrLog(
    "membership-invite",
    {
      to: email,
      subject: "You've been invited to FigBloom CRM",
      text: `You've been invited to join FigBloom's CRM. This link expires in 7 days and can only be used once.\n\n${acceptUrl}`,
      html: `<p>You've been invited to join FigBloom's CRM. This link expires in 7 days and can only be used once.</p><p><a href="${acceptUrl}">Accept your invite</a></p>`,
    },
    transportOverride,
  );
}

/**
 * Production email check, run once at boot and by /api/health. Returns the problem as a sentence, or null when mail can be
 * delivered. It does not stop the server: sign-in and the CRM work without mail, but invites and password resets would
 * silently go nowhere, so the problem is logged as an ERROR at boot and reported by /api/health (`email`).
 */
export function emailConfigProblem(env: Record<string, string | undefined> = process.env): string | null {
  const provider = emailProvider(env);
  if (provider === "none") {
    return "No email provider is configured: invites, password resets and notifications are NOT delivered. Set RESEND_API_KEY and EMAIL_FROM (or SMTP_HOST).";
  }
  if (provider === "resend" && !(env.EMAIL_FROM?.trim() || env.SMTP_FROM?.trim())) {
    return "RESEND_API_KEY is set but EMAIL_FROM is not: set EMAIL_FROM to an address on a domain verified in Resend.";
  }
  return null;
}
