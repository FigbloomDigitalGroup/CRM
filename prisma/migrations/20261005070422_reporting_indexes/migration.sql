-- FIG-603: indexes for the reporting queries in src/repositories/reporting.ts
-- that weren't covered by any existing index.

-- Lead volume by source / conversion summary: filtered by organizationId +
-- a createdAt range, and separately by convertedAt IS NOT NULL.
CREATE INDEX "leads_organization_id_created_at_idx" ON "leads"("organization_id", "created_at");
CREATE INDEX "leads_organization_id_converted_at_idx" ON "leads"("organization_id", "converted_at");

-- Won/lost summary and sales-by-service: filtered by organizationId +
-- outcome + a wonAt/lostAt range, and grouped by serviceId.
CREATE INDEX "deals_organization_id_outcome_won_at_idx" ON "deals"("organization_id", "outcome", "won_at");
CREATE INDEX "deals_organization_id_outcome_lost_at_idx" ON "deals"("organization_id", "outcome", "lost_at");
CREATE INDEX "deals_organization_id_service_id_idx" ON "deals"("organization_id", "service_id");

-- Follow-up performance: filtered by organizationId + a dueAt range
-- (assigneeMembershipId filter is optional, so dueAt needs its own index).
CREATE INDEX "tasks_organization_id_due_at_idx" ON "tasks"("organization_id", "due_at");
