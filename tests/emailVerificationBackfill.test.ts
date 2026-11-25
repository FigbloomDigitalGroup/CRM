import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { createTestOrganization } from "./helpers/fixtures";

/**
 * UC-F2: the migration's backfill marks an account verified ONLY when it was created through an invite or provisioning
 * and the invite was accepted. This runs the migration's own UPDATE statement against rows of each shape.
 */
const sql = readFileSync(join(__dirname, "..", "prisma", "migrations", "20261128100000_user_email_verified", "migration.sql"), "utf8");
const backfill = sql.slice(sql.indexOf('UPDATE "users" u'));

function minutes(base: Date, m: number): Date {
  return new Date(base.getTime() + m * 60_000);
}

async function userWithMembership(opts: { createdAt: Date; invitedAt: Date | null; joinedAt: Date | null; verified?: boolean }) {
  const org = await createTestOrganization();
  const role = await adminDb.role.findUniqueOrThrow({ where: { key: "SALES" } });
  const user = await adminDb.user.create({
    data: {
      email: `backfill.${randomUUID().slice(0, 8)}@example.test`,
      name: "Backfill Case",
      createdAt: opts.createdAt,
      emailVerifiedAt: opts.verified ? new Date("2026-01-01T00:00:00Z") : null,
    },
  });
  await adminDb.membership.create({
    data: { organizationId: org.id, userId: user.id, roleId: role.id, invitedAt: opts.invitedAt, joinedAt: opts.joinedAt },
  });
  return user.id;
}

const verifiedAt = async (id: string) => (await adminDb.user.findUniqueOrThrow({ where: { id } })).emailVerifiedAt;

describe("email_verified_at backfill (migration 20261128100000)", () => {
  it("verifies only accounts created through an accepted invite; leaves signup-made, never-accepted and already-verified ones alone", async () => {
    const t0 = new Date("2026-03-01T10:00:00Z");
    const viaInvite = await userWithMembership({ createdAt: t0, invitedAt: minutes(t0, 0.05), joinedAt: minutes(t0, 60) });
    const signedUpThenInvited = await userWithMembership({ createdAt: t0, invitedAt: minutes(t0, 60 * 24), joinedAt: minutes(t0, 60 * 24 + 5) });
    const invitedNeverAccepted = await userWithMembership({ createdAt: t0, invitedAt: minutes(t0, 0.05), joinedAt: null });
    const noInviteAtAll = await userWithMembership({ createdAt: t0, invitedAt: null, joinedAt: minutes(t0, 5) });
    const alreadyVerified = await userWithMembership({ createdAt: t0, invitedAt: null, joinedAt: null, verified: true });

    await adminDb.$executeRawUnsafe(backfill);

    expect(await verifiedAt(viaInvite)).not.toBeNull();
    expect(await verifiedAt(signedUpThenInvited)).toBeNull();
    expect(await verifiedAt(invitedNeverAccepted)).toBeNull();
    expect(await verifiedAt(noInviteAtAll)).toBeNull();
    expect((await verifiedAt(alreadyVerified))?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("is idempotent: running it again changes nothing", async () => {
    const t0 = new Date("2026-03-02T10:00:00Z");
    const viaInvite = await userWithMembership({ createdAt: t0, invitedAt: minutes(t0, 0.05), joinedAt: minutes(t0, 60) });
    await adminDb.$executeRawUnsafe(backfill);
    const first = await verifiedAt(viaInvite);
    await adminDb.$executeRawUnsafe(backfill);
    expect((await verifiedAt(viaInvite))?.toISOString()).toBe(first?.toISOString());
  });
});
