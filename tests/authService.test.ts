import { describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password";
import { resolveSessionUserId } from "../src/auth/session";
import { UnauthorizedError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import * as authService from "../src/services/authService";
import { createTestUser } from "./helpers/fixtures";

const PASSWORD = "correct-horse-battery";

async function createUserWithPassword(password = PASSWORD) {
  const user = await createTestUser();
  const passwordHash = await hashPassword(password);
  await adminDb.user.update({ where: { id: user.id }, data: { passwordHash } });
  return user;
}

describe("authService.login", () => {
  it("logs in with the correct email and password and produces a resolvable session", async () => {
    const user = await createUserWithPassword();

    const { token, userId } = await authService.login(user.email, PASSWORD);
    expect(userId).toBe(user.id);
    expect(await resolveSessionUserId(token)).toBe(user.id);
  });

  it("rejects the wrong password with the same generic message as an unknown email", async () => {
    const user = await createUserWithPassword();

    let wrongPasswordMessage = "";
    try {
      await authService.login(user.email, "not-the-password");
    } catch (err) {
      wrongPasswordMessage = (err as Error).message;
    }

    let unknownEmailMessage = "";
    try {
      await authService.login("nobody@example.test", "whatever-12345");
    } catch (err) {
      unknownEmailMessage = (err as Error).message;
    }

    expect(wrongPasswordMessage).not.toBe("");
    expect(wrongPasswordMessage).toBe(unknownEmailMessage);
  });

  it("rejects login for a user with no password set yet", async () => {
    const user = await createTestUser();
    await expect(authService.login(user.email, "anything-at-all")).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it("rejects login for an inactive user", async () => {
    const user = await createUserWithPassword();
    await adminDb.user.update({ where: { id: user.id }, data: { status: "INACTIVE" } });

    await expect(authService.login(user.email, PASSWORD)).rejects.toThrow(
      UnauthorizedError,
    );
  });
});

describe("authService.logout", () => {
  it("revokes the session so it no longer resolves", async () => {
    const user = await createUserWithPassword();
    const { token } = await authService.login(user.email, PASSWORD);
    expect(await resolveSessionUserId(token)).toBe(user.id);

    await authService.logout(token);
    expect(await resolveSessionUserId(token)).toBeNull();
  });
});

describe("authService password reset", () => {
  it("returns the same generic message whether or not the email exists", async () => {
    const user = await createUserWithPassword();

    const forExisting = await authService.requestPasswordReset(
      user.email,
      (token) => `https://example.test/reset-password?token=${token}`,
    );
    const forUnknown = await authService.requestPasswordReset(
      "nobody@example.test",
      (token) => `https://example.test/reset-password?token=${token}`,
    );

    expect(forExisting.message).toBe(forUnknown.message);
  });

  it("resets the password via a captured token, and the new password works while the old one doesn't", async () => {
    const user = await createUserWithPassword();
    let capturedToken = "";

    await authService.requestPasswordReset(user.email, (token) => {
      capturedToken = token;
      return `https://example.test/reset-password?token=${token}`;
    });
    expect(capturedToken).not.toBe("");

    const NEW_PASSWORD = "a-brand-new-password";
    await authService.resetPassword(capturedToken, NEW_PASSWORD);

    await expect(authService.login(user.email, PASSWORD)).rejects.toThrow(
      UnauthorizedError,
    );
    const { userId } = await authService.login(user.email, NEW_PASSWORD);
    expect(userId).toBe(user.id);
  });

  it("rejects reusing the same reset token twice", async () => {
    const user = await createUserWithPassword();
    let capturedToken = "";
    await authService.requestPasswordReset(user.email, (token) => {
      capturedToken = token;
      return token;
    });

    await authService.resetPassword(capturedToken, "first-new-password-12");
    await expect(
      authService.resetPassword(capturedToken, "second-new-password-34"),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a password that's too short", async () => {
    const user = await createUserWithPassword();
    let capturedToken = "";
    await authService.requestPasswordReset(user.email, (token) => {
      capturedToken = token;
      return token;
    });

    await expect(authService.resetPassword(capturedToken, "short")).rejects.toThrow(
      ValidationError,
    );
  });

  it("revokes existing sessions when the password is reset", async () => {
    const user = await createUserWithPassword();
    const { token: oldSessionToken } = await authService.login(user.email, PASSWORD);

    let capturedToken = "";
    await authService.requestPasswordReset(user.email, (token) => {
      capturedToken = token;
      return token;
    });
    await authService.resetPassword(capturedToken, "another-new-password-56");

    expect(await resolveSessionUserId(oldSessionToken)).toBeNull();
  });
});
