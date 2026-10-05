-- FIG-604: organization profile/defaults/working-hours columns.
ALTER TABLE "organizations" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Africa/Nairobi';
ALTER TABLE "organizations" ADD COLUMN "default_currency" TEXT NOT NULL DEFAULT 'KES';
ALTER TABLE "organizations" ADD COLUMN "phone" TEXT;
ALTER TABLE "organizations" ADD COLUMN "website" TEXT;
ALTER TABLE "organizations" ADD COLUMN "address" TEXT;
ALTER TABLE "organizations" ADD COLUMN "working_days" TEXT[] NOT NULL DEFAULT ARRAY['MON','TUE','WED','THU','FRI']::TEXT[];
ALTER TABLE "organizations" ADD COLUMN "working_hours_start" TEXT;
ALTER TABLE "organizations" ADD COLUMN "working_hours_end" TEXT;
