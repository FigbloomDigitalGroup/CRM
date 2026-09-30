import { afterEach, describe, expect, it, vi } from "vitest";
import { sendPasswordResetEmail, type MailTransport } from "../src/auth/email";

/**
 * A fake `MailTransport` proves the message we *compose* is correct
 * (recipient, a working link, sane subject/from) without needing a real
 * SMTP server -- see src/auth/email.ts's header comment for why the
 * transport is injectable at all.
 */
function fakeTransport() {
  const sendMail = vi.fn().mockResolvedValue(undefined);
  return { sendMail } as unknown as MailTransport & { sendMail: typeof sendMail };
}

const originalEnv = { ...process.env };
afterEach(() => {
  process.env = { ...originalEnv };
});

describe("sendPasswordResetEmail", () => {
  it("sends a real message (via the injected transport) containing the reset link", async () => {
    const transport = fakeTransport();

    await sendPasswordResetEmail(
      "someone@example.test",
      "https://crm.example.test/reset-password?token=abc123",
      transport,
    );

    expect(transport.sendMail).toHaveBeenCalledTimes(1);
    const message = transport.sendMail.mock.calls[0][0];
    expect(message.to).toBe("someone@example.test");
    expect(message.subject).toMatch(/reset/i);
    expect(message.text).toContain(
      "https://crm.example.test/reset-password?token=abc123",
    );
    expect(message.html).toContain(
      "https://crm.example.test/reset-password?token=abc123",
    );
    expect(message.from).toBeTruthy();
  });

  it("uses SMTP_FROM when configured", async () => {
    process.env.SMTP_FROM = "Custom Sender <sender@example.test>";
    const transport = fakeTransport();

    await sendPasswordResetEmail("x@example.test", "https://example.test/reset", transport);

    expect(transport.sendMail.mock.calls[0][0].from).toBe(
      "Custom Sender <sender@example.test>",
    );
  });

  it("does not throw when no SMTP is configured and no transport override is given", async () => {
    delete process.env.SMTP_HOST;
    await expect(
      sendPasswordResetEmail("x@example.test", "https://example.test/reset"),
    ).resolves.toBeUndefined();
  });
});
