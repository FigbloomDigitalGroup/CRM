-- AlterEnum
ALTER TYPE "MembershipStatus" ADD VALUE 'PENDING';

-- AlterTable
ALTER TABLE "memberships"
  ADD COLUMN "invite_token_hash" TEXT,
  ADD COLUMN "invite_token_expires_at" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "memberships_invite_token_hash_key" ON "memberships"("invite_token_hash");
