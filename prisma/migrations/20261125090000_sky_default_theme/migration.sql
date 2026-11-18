-- Sky is the default theme of the whole system (Given, 10 Nov 2026). New organisations start on Sky, and organisations still on the old
-- default (Forest) move to it. Members who picked a theme of their own keep it: that choice lives in member preferences, not here.
ALTER TABLE "organizations" ALTER COLUMN "default_theme" SET DEFAULT 'SKY';
UPDATE "organizations" SET "default_theme" = 'SKY' WHERE "default_theme" = 'FOREST';
