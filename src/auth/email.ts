import nodemailer from "nodemailer";

/**
 * Outbound auth email (FIG-592 password reset, FIG-593 membership invites).
 * Sends real SMTP mail once `SMTP_HOST` is configured (see .env.example);
 * until then, falls back to logging the message server-side so both flows
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

async function deliverOrLog(
  logLabel: string,
  message: { to: string; subject: string; text: string; html: string },
  transportOverride?: MailTransport,
): Promise<void> {
  if (!transportOverride && !isSmtpConfigured()) {
    console.log(
      `[${logLabel}] No email provider configured -- would send to ${message.to}:\n${message.text}`,
    );
    return;
  }

  const transport = transportOverride ?? createRealTransport();
  await transport.sendMail({
    from: process.env.SMTP_FROM ?? "FigBloom CRM <no-reply@figbloom.local>",
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
