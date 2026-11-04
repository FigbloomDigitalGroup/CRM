# Supabase spike: results and go / no-go record (FIG-1255, P1.11)

Run on 4 Nov 2026 against a new, empty Supabase project on the **Free plan**, region **Europe, eu-west-1 (Ireland)**. Plan and reasoning: `docs/SUPABASE_PLAN.md`. No secret is written in this file; the connection details live outside the repository.

**Status: technical checks pass; the written sign-off below is still empty. The full test suites were not run on Supabase (see "Not done").**

## Results

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | All migrations apply | **Pass** | 52 of 52 migrations applied through the session pooler in 85 s (`prisma migrate deploy`). PostgreSQL 17.11 |
| 2 | Role bootstrap and grants | **Pass, unchanged** | `db:bootstrap-role` and `db:grant-role` ran as the non-superuser `postgres` role. `figbloom_app` is created without superuser and without `BYPASSRLS`; the append-only `audit_events` and the restricted tables keep their revokes |
| 3 | Pooler, Prisma-style transactions and the per-transaction organisation setting | **Pass** | Through the transaction pooler (port 6543) as `figbloom_app`: no setting shows 0 rows; setting organisation A in a transaction shows only A; the setting is empty after `COMMIT`; an insert into organisation B while A is set is refused (`WITH CHECK`); **300 concurrent transactions on 6 clients, 0 wrong-organisation sightings** |
| 4 | `pg_trgm` | **Pass** | Installs in `public`; `similarity()` works for the app role without schema qualification; all 11 trigram indexes were created by the migrations |
| 5 | `anon` reads nothing, Data API closed | **Pass** | 73 public tables, all with row-level security on. `anon` could select 0 tables even before the change (new projects no longer grant by default); we still revoked all rights from `anon` and `authenticated` on tables, sequences and functions, revoked schema usage, and reset default privileges. A call to the Data API with the publishable key returns 401 (`42501`) for tenant tables and for `_prisma_migrations`. `figbloom_app` kept its rights |
| 6 | Latency and cost | **Concern** | See below |

## What the spike found that the plan did not predict

1. **The direct host is IPv6-only.** `db.<ref>.supabase.co` did not connect from this computer (`ENETUNREACH`). Use the **session pooler** (port 5432) for migrations and administration and the **transaction pooler** (port 6543) for the app. A host without IPv6 hits the same problem on the direct host.
2. **The pooler certificate is signed by Supabase's own root CA** ("Supabase Root 2021 CA", valid to 2031). Certificate checking must stay on, so every client needs that CA file: Prisma takes `sslcert=<path to the CA file>` with `sslmode=require`; `pg` takes `ssl: { ca }`, or `sslmode=verify-ca&sslrootcert=<path>` in the URL. **Never turn certificate checking off to get past this.** Download the file from Project Settings, Database, SSL Configuration.
3. **Pooler user names carry the project reference:** `postgres.<ref>` and `figbloom_app.<ref>`.
4. **73 tenant-and-support tables**, not the 63 the plan quoted. Update the plan's number.
5. **Round trip is about 181 ms** (median; p95 194 ms) from this computer in Kenya to eu-west-1. This is the one real concern: a request that makes five queries spends about a second on the database alone if the app runs far from it.

## Recommendation

**Go for staging on Supabase, with conditions.** Everything technical that the plan marked as a risk passed on the first run, and nothing needs a change to our code or contract.

Conditions:

1. **Run the app in the same region as the database** (eu-west-1 / Ireland). Then database round trips cost a millisecond or two, and the user pays one trip between the browser and the app (about 180 ms from Nairobi). Do not host the app in Kenya and the database in Ireland.
2. **The Free plan is for the spike and for staging only.** It has no point-in-time recovery and no dependable backups, and the project pauses after a week of inactivity, which would hurt UAT between sessions. Production needs a paid plan with backups, and point-in-time recovery if the recovery objective in FIG-1125 requires it.
3. **Kenya Data Protection Act.** There is no African region (Europe was the recommended one), so production data would be stored abroad. Staging holds only anonymised data and is not affected. The transfer assessment for production stays in FIG-1258 and FIG-1128 and needs your decision.
4. **Reset the database password** after the spike, because it was pasted in a chat. Update the local file and the host's secret store.
5. **The Data API stays off** and the revokes in check 5 are part of the deploy (add them to `docs/STAGING.md` and the runbook).

If any condition cannot be met, the fallback is a managed Postgres elsewhere. The repository side does not change.

## Not done (so the record is honest)

- The **full Vitest suite, the tenant attack suite and the performance suite** were not run against Supabase. They need Docker and a test-database setup for this host; the performance targets in `docs/PERF_BASELINE.md` still have to be re-measured with the app in the same region as the database.
- **Storage** (FIG-1257, private bucket through the S3 driver) was not tested.
- The **backup and restore drill** (FIG-1125, FIG-1258) was not run; the Free plan cannot support it.
- **Cost** of the paid plan and of point-in-time recovery was not confirmed on the dashboard.

## Sign-off

| | |
|---|---|
| Decision (go / no-go) | |
| Conditions accepted | |
| Signed by | |
| Date | |
