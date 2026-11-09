import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  emailConfigProblem,
  emailProvider,
  sendMembershipInviteEmail,
  sendPasswordResetEmail,
  type MailTransport,
} from "../src/auth/email";

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
beforeEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
});
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

describe("sendMembershipInviteEmail", () => {
  it("sends a message containing the accept-invite link", async () => {
    const transport = fakeTransport();

    await sendMembershipInviteEmail(
      "invitee@example.test",
      "https://crm.example.test/accept-invite?token=xyz789",
      transport,
    );

    expect(transport.sendMail).toHaveBeenCalledTimes(1);
    const message = transport.sendMail.mock.calls[0][0];
    expect(message.to).toBe("invitee@example.test");
    expect(message.subject).toMatch(/invited/i);
    expect(message.text).toContain(
      "https://crm.example.test/accept-invite?token=xyz789",
    );
    expect(message.html).toContain(
      "https://crm.example.test/accept-invite?token=xyz789",
    );
  });

  it("does not throw when no SMTP is configured", async () => {
    delete process.env.SMTP_HOST;
    await expect(
      sendMembershipInviteEmail("x@example.test", "https://example.test/accept-invite"),
    ).resolves.toBeUndefined();
  });
});

describe("deliverOrLog without SMTP", () => {
  it("logs the link outside production (dev and tests read it from the log)", async () => {
    delete process.env.SMTP_HOST;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await sendPasswordResetEmail("x@example.test", "https://example.test/reset-password?token=devtoken");
    expect(log.mock.calls.flat().join("\n")).toContain("devtoken");
    log.mockRestore();
  });

  it("never writes the body or link to any log in production", async () => {
    delete process.env.SMTP_HOST;
    vi.stubEnv("NODE_ENV", "production");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await sendPasswordResetEmail("x@example.test", "https://example.test/reset-password?token=secrettoken");
    const all = [...log.mock.calls, ...err.mock.calls, ...warn.mock.calls].flat().join("\n");
    expect(all).not.toContain("secrettoken");
    expect(all).toContain("x@example.test");
    log.mockRestore();
    err.mockRestore();
    warn.mockRestore();
    vi.unstubAllEnvs();
  });
});

describe("Resend as the auth email provider (MVP-11)", () => {
  it("picks SMTP over Resend, Resend when only the key is set, else none", () => {
    expect(emailProvider({ SMTP_HOST: "smtp.example.test", RESEND_API_KEY: "k" })).toBe("smtp");
    expect(emailProvider({ RESEND_API_KEY: "k" })).toBe("resend");
    expect(emailProvider({})).toBe("none");
  });

  it("sends the invite through the Resend API with both text and html, and never logs the link", async () => {
    delete process.env.SMTP_HOST;
    process.env.RESEND_API_KEY = "test-key-placeholder";
    process.env.EMAIL_FROM = "FigBloom <crm@mail.example.test>";
    vi.stubEnv("NODE_ENV", "production");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "msg_1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await sendMembershipInviteEmail("invitee@example.test", "https://crm.example.test/accept-invite?token=secrettoken");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.resend.com/emails");
      const body = JSON.parse(init.body);
      expect(body.from).toBe("FigBloom <crm@mail.example.test>");
      expect(body.to).toEqual(["invitee@example.test"]);
      expect(body.text).toContain("secrettoken");
      expect(body.html).toContain("secrettoken");
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("in production a missing EMAIL_FROM is a clear error, not a silent drop", async () => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_FROM;
    process.env.RESEND_API_KEY = "test-key-placeholder";
    vi.stubEnv("NODE_ENV", "production");
    vi.stubGlobal("fetch", vi.fn());
    try {
      await expect(sendPasswordResetEmail("x@example.test", "https://example.test/r")).rejects.toThrow(/EMAIL_FROM/);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("emailConfigProblem names what is missing", () => {
    expect(emailConfigProblem({})).toMatch(/RESEND_API_KEY and EMAIL_FROM/);
    expect(emailConfigProblem({ RESEND_API_KEY: "k" })).toMatch(/EMAIL_FROM/);
    expect(emailConfigProblem({ RESEND_API_KEY: "k", EMAIL_FROM: "a@b.test" })).toBeNull();
    expect(emailConfigProblem({ SMTP_HOST: "h" })).toBeNull();
  });

  it("emailConfigProblem catches an SMTP login with no password, but allows a server with no login at all", () => {
    // A mail user without its password would be refused by the server on every message while /api/health said "ok".
    expect(emailConfigProblem({ SMTP_HOST: "smtp.gmail.com", SMTP_USER: "me@example.test" })).toMatch(/SMTP_PASS/);
    expect(emailConfigProblem({ SMTP_HOST: "smtp.gmail.com", SMTP_USER: "me@example.test", SMTP_PASS: "  " })).toMatch(/SMTP_PASS/);
    expect(emailConfigProblem({ SMTP_HOST: "smtp.gmail.com", SMTP_USER: "me@example.test", SMTP_PASS: "secret" })).toBeNull();
    // A local mail catcher (staging) has no login: still fine.
    expect(emailConfigProblem({ SMTP_HOST: "mailpit" })).toBeNull();
  });
});
