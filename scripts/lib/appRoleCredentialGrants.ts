/**
 * UC-F3 (Security S-4): what the tenant-facing database role (`figbloom_app`) may and may not see of the credential tables.
 * One list, read by `scripts/db-admin.ts` (which applies it after every migration), by `scripts/verify-migration.ts` (which checks it)
 * and by `tests/appRoleCredentialGrants.test.ts` (which proves it). Plain data: no imports, no connection.
 *
 * `users` is not row-level-secured and holds every organisation's people, so the app role gets SELECT on the non-secret columns only
 * and no write privilege at all (sign-up, invites, profile and lockout all run on the owner connection, `adminDb`).
 * `password_reset_tokens` is the owner connection's alone.
 *
 * The lists are explicit on purpose: a new column on `users` is NOT readable by the app role until someone adds it to the first list,
 * and the drift test fails until every column is in exactly one of the two lists.
 */

/** Columns of `users` the app role may SELECT. */
export const APP_ROLE_USER_READABLE_COLUMNS = ["id", "email", "name", "phone", "status", "created_at", "updated_at", "time_zone"] as const;

/** Columns of `users` the app role may never read: the password hash, the sign-in lockout state and the email-verification state (UC-F2; read only by sign-in and invite acceptance on the owner connection). */
export const USER_CREDENTIAL_COLUMNS = ["password_hash", "failed_sign_in_count", "last_failed_sign_in_at", "locked_until", "email_verified_at"] as const;

/** Tables the app role has no privilege on at all (reset-token hashes). */
export const APP_ROLE_NO_ACCESS_CREDENTIAL_TABLES = ["password_reset_tokens"] as const;
