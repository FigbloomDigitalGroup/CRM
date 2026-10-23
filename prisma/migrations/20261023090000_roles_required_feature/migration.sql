-- FIG-1017 (B1.01): a role can depend on a feature toggle. The sixth role,
-- Customer Support, is in the catalogue but is neither assignable nor does it
-- carry permissions until the organisation switches `customer_support.role`
-- on. The column is plain reference data (roles is global, not tenant-scoped).
ALTER TABLE "roles" ADD COLUMN "required_feature" TEXT;
