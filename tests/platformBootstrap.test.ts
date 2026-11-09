import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "../src/auth/password";
import { adminDb } from "../src/db/adminClient";
import { acceptPlatformInvite } from "../src/services/platformAdminService";
import { bootstrapFirstPlatformAdmin } from "../src/services/platformBootstrapService";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));

/** MVP-10: the bootstrap command is one-time, creates no dev account, and the link it prints sets up exactly one identity. */
const email = () => `first.${randomUUID().slice(0, 8)}@platform.example.com`;

async function counts() {
  return {
    dev: await adminDb.platformIdentity.count({ where: { isDev: true } }),
    devUsers: await adminDb.user.count({ where: { email: { endsWith: "@figbloom.local" } } }),
    real: await adminDb.platformIdentity.count({ where: { isDev: false } }),
  };
}

async function wipe() {
  await adminDb.platformAdminInvite.deleteMany({ where: { email: { endsWith: "@platform.example.com" } } });
  await adminDb.platformIdentity.deleteMany({ where: { isDev: false } });
}
beforeEach(wipe);
afterAll(wipe);

describe("bootstrapFirstPlatformAdmin", () => {
  it("issues one invitation, creates no account and no dev account, and accepting it creates exactly one identity", async () => {
    const before = await counts();
    const e = email();
    const link = await bootstrapFirstPlatformAdmin({ email: e, name: "Michael" });
    expect(link.kind).toBe("INVITE");
    expect(link.inviteUrl).toContain("/platform/accept-invite?token=");
    expect(await counts()).toEqual(before);

    const token = new URL(link.inviteUrl).searchParams.get("token")!;
    await acceptPlatformInvite(token, `pw-${randomUUID()}-Aa1`, null, null);
    const after = await counts();
    expect(after.real).toBe(1);
    expect(after.dev).toBe(before.dev);
    expect(after.devUsers).toBe(before.devUsers);
    const identity = await adminDb.platformIdentity.findUniqueOrThrow({ where: { email: e } });
    expect(identity.isDev).toBe(false);
  });

  it("refuses a second run once a platform admin exists, unless forced", async () => {
    const e = email();
    await adminDb.platformIdentity.create({ data: { email: e, name: "Existing", passwordHash: await hashPassword(`pw-${randomUUID()}-Aa1`), isDev: false } });
    await expect(bootstrapFirstPlatformAdmin({ email: email(), name: "Second" })).rejects.toThrow(/one-time/);
    const recovery = await bootstrapFirstPlatformAdmin({ email: e, name: "Existing", force: true });
    expect(recovery.kind).toBe("RECOVERY");
    expect(await adminDb.platformIdentity.count({ where: { isDev: false } })).toBe(1);
  });

  it("in production refuses without APP_BASE_URL", async () => {
    await expect(bootstrapFirstPlatformAdmin({ email: email(), name: "Michael", env: { NODE_ENV: "production" } })).rejects.toThrow(/APP_BASE_URL/);
  });

  it("validates the email and name", async () => {
    await expect(bootstrapFirstPlatformAdmin({ email: "nope", name: "X" })).rejects.toThrow(/valid email/);
    await expect(bootstrapFirstPlatformAdmin({ email: email(), name: " " })).rejects.toThrow(/name/i);
  });
});
