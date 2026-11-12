-- P2-15 (FIG-1598) Team page: "last active" and recent activity read the latest audit events of one person.
-- Additive and safe to repeat.
CREATE INDEX IF NOT EXISTS "audit_events_organization_id_actor_membership_id_created_at_idx"
  ON "audit_events" ("organization_id", "actor_membership_id", "created_at");
