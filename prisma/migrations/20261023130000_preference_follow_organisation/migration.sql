-- FIG-1024 (B1.08): a member who never chose a theme or page colour follows the
-- organisation's default look. Saving, say, only a density must not silently pin
-- the brand colours, so theme and page colour become "unset" (NULL) by default.
ALTER TABLE "user_preferences" ALTER COLUMN "theme" DROP NOT NULL;
ALTER TABLE "user_preferences" ALTER COLUMN "theme" DROP DEFAULT;
ALTER TABLE "user_preferences" ALTER COLUMN "page_colour" DROP NOT NULL;
ALTER TABLE "user_preferences" ALTER COLUMN "page_colour" DROP DEFAULT;

-- The Platform Super Admin may choose light or dark for their console, nothing else.
ALTER TABLE "platform_identities" ADD COLUMN "ui_mode" TEXT NOT NULL DEFAULT 'LIGHT';
ALTER TABLE "platform_identities" ADD CONSTRAINT "platform_identities_ui_mode_check" CHECK ("ui_mode" IN ('LIGHT', 'DARK'));
