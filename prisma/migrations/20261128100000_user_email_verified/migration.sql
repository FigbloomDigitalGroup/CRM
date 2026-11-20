-- UC-F2 (FIG-1766, audit S-3): remember whether the person proved they control the mailbox.
-- Additive and nullable: nothing is dropped, renamed or retyped, and no one is signed out or locked out by this migration.
ALTER TABLE "users" ADD COLUMN "email_verified_at" TIMESTAMP(3);

-- Backfill, deliberately narrow (Given decides the rest, see docs/DECISIONS.md once recorded):
-- an account counts as verified only if it was CREATED THROUGH AN INVITE OR PROVISIONING and the invite was accepted. Those
-- rows are created in the same request as the invite, so the account's creation time sits within a minute of the invite's
-- time. A signup-made account that someone later invited was created well before the invite, so it stays unverified.
UPDATE "users" u
SET "email_verified_at" = COALESCE(
  (SELECT MIN(m."joined_at") FROM "memberships" m WHERE m."user_id" = u."id" AND m."joined_at" IS NOT NULL),
  CURRENT_TIMESTAMP
)
WHERE u."email_verified_at" IS NULL
  AND EXISTS (
    SELECT 1 FROM "memberships" m
    WHERE m."user_id" = u."id"
      AND m."invited_at" IS NOT NULL
      AND m."joined_at" IS NOT NULL
      AND u."created_at" BETWEEN m."invited_at" - INTERVAL '1 minute' AND m."invited_at" + INTERVAL '1 minute'
  );
