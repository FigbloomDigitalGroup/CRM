import nodemailer from "nodemailer";

/**
 * Password-reset email delivery (FIG-592). Sends real SMTP mail once
 * `SMTP_HOST` is configured (see .env.example); until then, falls back to
 * logging the link server-side so the flow stays exercisable in any
 * environment without credentials. `transportOverride` exists only for
 * tests -- it lets `tests/authEmail.test.ts` verify the composed message
 * without a real SMTP server, the same way `resolveRequestContext`'s tests
 * inject a fake cookie reader instead of a real Next.js request.
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

export async function sendPasswordResetEmail(
  email: string,
  resetUrl: string,
  transportOverride?: MailTransport,
): Promise<void> {
  if (!transportOverride && !isSmtpConfigured()) {
    console.log(
      `[password-reset] No email provider configured -- link for ${email}: ${resetUrl}`,
    );
    return;
  }

  const transport = transportOverride ?? createRealTransport();
  await transport.sendMail({
    from: process.env.SMTP_FROM ?? "FigBloom CRM <no-reply@figbloom.local>",
    to: email,
    subject: "Reset your FigBloom CRM password",
    text: `Use this link to reset your password. It expires in 1 hour and can only be used once.\n\n${resetUrl}`,
    html: `<p>Use this link to reset your password. It expires in 1 hour and can only be used once.</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
  });
}
