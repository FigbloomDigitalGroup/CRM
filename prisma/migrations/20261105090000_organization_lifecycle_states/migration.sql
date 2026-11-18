-- FIG-1136/1137 (B6.04, B6.05): the organisation lifecycle. `ACTIVE` and the
-- older `INACTIVE` stay; a platform admin can now also suspend an organisation
-- (reversible), start its offboarding, and an offboarded organisation (its data
-- deleted, B6.09) stays behind as a tombstone so its slug is never reused.
-- Kept in a migration of its own: a new enum value cannot be used in the
-- transaction that adds it.
ALTER TYPE "OrganizationStatus" ADD VALUE IF NOT EXISTS 'SUSPENDED';
ALTER TYPE "OrganizationStatus" ADD VALUE IF NOT EXISTS 'OFFBOARDING';
ALTER TYPE "OrganizationStatus" ADD VALUE IF NOT EXISTS 'OFFBOARDED';
