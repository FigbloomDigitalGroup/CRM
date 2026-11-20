/**
 * UC-F7: the tables the tenant-facing database role (`figbloom_app`) is deliberately kept out of. Plain data: no imports, no connection.
 *
 * `scripts/db-admin.ts` revokes these after every migration (platform identity and audit tables, the two-step tables, rate-limit attempts,
 * reset tokens, lifecycle events). `scripts/verify-migration.ts` used to demand SELECT on every table and so failed on a healthy database;
 * it now expects exactly this set to be closed and fails when a closed table is readable or any other table is not.
 *
 * `users` is in neither list: it is column-limited (see `appRoleCredentialGrants.ts`) and judged by its own check.
 * A table that does not exist yet in the database is ignored here, so the list can name tables of later releases.
 */
export const APP_ROLE_CLOSED_TABLES = [
  "auth_rate_limit_attempts",
  "organization_lifecycle_events",
  "password_reset_tokens",
  "platform_admin_invites",
  "platform_announcements",
  "platform_audit_events",
  "platform_audit_verifications",
  "platform_backup_codes",
  "platform_data_request_approvals",
  "platform_data_requests",
  "platform_deletion_certificates",
  "platform_idempotency_keys",
  "platform_identities",
  "platform_incidents",
  "platform_sessions",
  "platform_settings",
  "platform_two_step",
  "platform_two_step_challenges",
  "two_step_challenges",
  "user_backup_codes",
  "user_trusted_devices",
  "user_two_step",
] as const;

/** Tables whose table-level SELECT is withheld but which the app role reads by column: judged by the UC-F3 check, not here. */
export const APP_ROLE_COLUMN_LIMITED_TABLES = ["users"] as const;
