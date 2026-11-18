import type { PrismaClient } from "@prisma/client";
import { adminDb } from "../../db/adminClient";
import { getPlatformDb } from "../../db/platformClient";
import { createTwoStepEngine, type ChallengePurpose, type StoredChallenge, type TwoStepStore } from "./engine";

/**
 * The two stores behind the shared engine (FIG-1134). Tenant users: tables
 * `user_*` and `two_step_challenges`, through the schema-owner connection (the
 * tenant application role is revoked from them). Platform admins: tables
 * `platform_*`, through the platform database role, which can touch nothing else.
 */

type Row = { id: string; purpose: string; expiresAt: Date; attempts: number; consumedAt: Date | null; createdAt: Date; userAgent: string | null; ipAddress: string | null; place: string | null };
function toChallenge(subjectId: string, row: Row): StoredChallenge {
  return { ...row, subjectId, purpose: row.purpose as ChallengePurpose };
}

export function tenantTwoStepStore(db: PrismaClient = adminDb): TwoStepStore {
  return {
    getCredential: (userId) => db.userTwoStep.findUnique({ where: { userId } }),
    async saveSecret(userId, secretEncrypted) {
      await db.userTwoStep.upsert({
        where: { userId },
        create: { userId, secretEncrypted },
        update: { secretEncrypted, enabledAt: null, lastUsedStep: null },
      });
    },
    async enable(userId) {
      await db.userTwoStep.update({ where: { userId }, data: { enabledAt: new Date() } });
    },
    async advanceStep(userId, step) {
      const result = await db.$executeRaw`UPDATE "user_two_step" SET "last_used_step" = ${step}, "updated_at" = now() WHERE "user_id" = ${userId} AND ("last_used_step" IS NULL OR "last_used_step" < ${step})`;
      return result === 1;
    },
    async deleteCredential(userId) {
      await db.userBackupCode.deleteMany({ where: { userId } });
      await db.userTwoStep.deleteMany({ where: { userId } });
    },
    async replaceBackupCodes(userId, hashes) {
      await db.$transaction([
        db.userBackupCode.deleteMany({ where: { userId } }),
        db.userBackupCode.createMany({ data: hashes.map((codeHash) => ({ userId, codeHash })) }),
      ]);
    },
    async consumeBackupCode(userId, codeHash) {
      const r = await db.userBackupCode.updateMany({ where: { userId, codeHash, usedAt: null }, data: { usedAt: new Date() } });
      return r.count === 1;
    },
    countBackupCodes: (userId) => db.userBackupCode.count({ where: { userId, usedAt: null } }),
    async createChallenge(input) {
      const row = await db.twoStepChallenge.create({
        data: { userId: input.subjectId, purpose: input.purpose, tokenHash: input.tokenHash, expiresAt: input.expiresAt, userAgent: input.userAgent ?? null, ipAddress: input.ipAddress ?? null, place: input.place ?? null },
      });
      return toChallenge(row.userId, row);
    },
    async findChallenge(tokenHash) {
      const row = await db.twoStepChallenge.findUnique({ where: { tokenHash } });
      return row ? toChallenge(row.userId, row) : null;
    },
    async addAttempt(id) {
      const row = await db.twoStepChallenge.update({ where: { id }, data: { attempts: { increment: 1 } } });
      return row.attempts;
    },
    async consumeChallenge(id) {
      const r = await db.twoStepChallenge.updateMany({ where: { id, consumedAt: null }, data: { consumedAt: new Date() } });
      return r.count === 1;
    },
    async clearChallenges(userId) {
      await db.twoStepChallenge.deleteMany({ where: { userId } });
    },
  };
}

export function platformTwoStepStore(db: () => PrismaClient = getPlatformDb): TwoStepStore {
  return {
    getCredential: (platformIdentityId) => db().platformTwoStep.findUnique({ where: { platformIdentityId } }),
    async saveSecret(platformIdentityId, secretEncrypted) {
      await db().platformTwoStep.upsert({
        where: { platformIdentityId },
        create: { platformIdentityId, secretEncrypted },
        update: { secretEncrypted, enabledAt: null, lastUsedStep: null },
      });
    },
    async enable(platformIdentityId) {
      await db().platformTwoStep.update({ where: { platformIdentityId }, data: { enabledAt: new Date() } });
    },
    async advanceStep(platformIdentityId, step) {
      const result = await db().$executeRaw`UPDATE "platform_two_step" SET "last_used_step" = ${step}, "updated_at" = now() WHERE "platform_identity_id" = ${platformIdentityId} AND ("last_used_step" IS NULL OR "last_used_step" < ${step})`;
      return result === 1;
    },
    async deleteCredential(platformIdentityId) {
      await db().platformBackupCode.deleteMany({ where: { platformIdentityId } });
      await db().platformTwoStep.deleteMany({ where: { platformIdentityId } });
    },
    async replaceBackupCodes(platformIdentityId, hashes) {
      await db().$transaction([
        db().platformBackupCode.deleteMany({ where: { platformIdentityId } }),
        db().platformBackupCode.createMany({ data: hashes.map((codeHash) => ({ platformIdentityId, codeHash })) }),
      ]);
    },
    async consumeBackupCode(platformIdentityId, codeHash) {
      const r = await db().platformBackupCode.updateMany({ where: { platformIdentityId, codeHash, usedAt: null }, data: { usedAt: new Date() } });
      return r.count === 1;
    },
    countBackupCodes: (platformIdentityId) => db().platformBackupCode.count({ where: { platformIdentityId, usedAt: null } }),
    async createChallenge(input) {
      const row = await db().platformTwoStepChallenge.create({
        data: { platformIdentityId: input.subjectId, purpose: input.purpose, tokenHash: input.tokenHash, expiresAt: input.expiresAt, userAgent: input.userAgent ?? null, ipAddress: input.ipAddress ?? null, place: input.place ?? null },
      });
      return toChallenge(row.platformIdentityId, row);
    },
    async findChallenge(tokenHash) {
      const row = await db().platformTwoStepChallenge.findUnique({ where: { tokenHash } });
      return row ? toChallenge(row.platformIdentityId, row) : null;
    },
    async addAttempt(id) {
      const row = await db().platformTwoStepChallenge.update({ where: { id }, data: { attempts: { increment: 1 } } });
      return row.attempts;
    },
    async consumeChallenge(id) {
      const r = await db().platformTwoStepChallenge.updateMany({ where: { id, consumedAt: null }, data: { consumedAt: new Date() } });
      return r.count === 1;
    },
    async clearChallenges(platformIdentityId) {
      await db().platformTwoStepChallenge.deleteMany({ where: { platformIdentityId } });
    },
  };
}

export const tenantTwoStep = createTwoStepEngine(tenantTwoStepStore());
let platformEngine: ReturnType<typeof createTwoStepEngine> | undefined;
/** Created on first use: the platform client needs PLATFORM_DATABASE_URL and fails closed without it. */
export function platformTwoStep() {
  platformEngine ??= createTwoStepEngine(platformTwoStepStore());
  return platformEngine;
}
