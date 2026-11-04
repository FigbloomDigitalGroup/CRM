# Backups, restore drill, RPO and RTO (FIG-1125, P1.03; backup half of FIG-1258, P1.14)

Database: plain PostgreSQL, local for now, AWS later (Michael, 4 Nov 2026). Nothing here depends on a vendor service: only `pg_dump`, `pg_restore`, standard WAL archiving and an object store reached through our storage adapter.

Status: **targets confirmed 4 Nov 2026 (`docs/DECISIONS.md` 6.3); WAL archiving not needed at launch.** The backup storage choice below is still for Given to make. The drill has been run on the local staging stack (4 Nov 2026, end of section 7), at small volume only; a timed drill at production volume, with decryption and the real backup storage, has not.

## 1. What is backed up

| Asset | Where it lives | Method |
|---|---|---|
| Database (all tenants, audit, settings) | PostgreSQL | `pg_dump` custom format, nightly; optional WAL archiving (section 3) |
| Uploaded files (attachments, exports, signed-URL content) | Object store (storage adapter, `docs/DEPLOYMENT.md`) | Versioned bucket plus a copy to a second location (section 4) |
| Configuration and secrets | Environment / secret store | Not in backups. Kept in the secret store; recorded in the staging runbook. Never put secrets in a dump folder. |
| Code and migrations | Git (`dev-given`, later `main`) | Git is the backup. A restored database is upgraded with `npm run migrate:deploy`. |

Roles are cluster-level and are **not** in a `pg_dump` of one database. After a restore on a new server run `npm run db:bootstrap-role` and `npm run db:grant-role` (they recreate `figbloom_app`, set its password from `APP_DB_PASSWORD` and re-apply the grants and the revokes on `audit_events`, `website_lead_request_log`, `auth_rate_limit_attempts`, `platform_identities`).

## 2. Schedule and retention (proposed)

Nightly logical backup:

```bash
pg_dump -Fc -f figbloom-$(date -u +%Y%m%dT%H%M%SZ).dump "$DATABASE_URL"
```

| Copy | Kept |
|---|---|
| Daily | 14 days |
| Weekly (Sunday's daily) | 8 weeks |
| Monthly (first Sunday) | 12 months |
| Pre-change dump (before a release that has migrations, and before cutover) | until the release is signed off plus 30 days |

Retention is a proposal. It must not conflict with erasure requests under the Data Protection Act: a deleted customer stays in older backups until those age out, which is acceptable only if restores re-apply erasures (record the erasure log with `docs/PRIVACY.md` and replay it after any restore that goes back past an erasure). Raise this in the P1.06 assessment.

Every backup job must: exit non-zero on failure, alert on failure or a missing nightly file (no news is not good news), and write the file size and duration to the log (no data). A dump that is suddenly much smaller than the previous one is an alert.

## 3. Point-in-time recovery (the option, and the trade-off)

A nightly dump alone means that after a failure we lose everything since the last dump: up to about 24 hours.

**Option: continuous WAL archiving** (`wal_level = replica`, `archive_mode = on`, `archive_command` copying each WAL segment to the backup storage, plus a periodic `pg_basebackup`). A restore replays the base backup and then the WAL up to a chosen instant (`recovery_target_time`), so data loss shrinks to minutes and we can also recover to just before a bad deploy or a mistaken bulk delete.

Trade-off, stated plainly:

* Gain: RPO of minutes instead of a day; recover to a point in time, not only to last night.
* Cost: more moving parts (archive command, base backups, retention of WAL, a monitored archive lag), more storage, a restore that is slower and has more steps to get wrong, and it restores the whole cluster, not one tenant. It needs the same restore drill, run on a schedule, or it is untested hope.
* Dump alone is simpler, restores a single database, and also serves as the migration path to AWS and for scratch copies.

Recommendation: start with nightly dumps plus the pre-change dump, because V1 launches with a small data volume and a business where a day's lost edits can be re-entered. Turn on WAL archiving before the volume or the business impact makes a day of loss unacceptable, or if Given sets an RPO under 24 hours. Keep nightly dumps even then.

## 4. File storage (object store)

* Turn on object versioning and a delete-marker retention of 30 days, so an overwritten or deleted file can be recovered.
* Nightly: copy new and changed objects to a second location (a different account or a different provider or site) with `rclone sync --immutable` or the provider's replication. The copy credentials can write but not delete.
* Files are referenced by key in the database; a database restore to time T therefore needs the object store as at T or later. Never delete objects that a dump younger than the retention period might reference: the sweeper that removes orphaned files must wait longer than the longest database retention you want to be able to restore to (proposed: 35 days).
* Restore procedure: restore the database first, then point a scratch app at the copied bucket and open a sample of files per organisation; run the existing orphan report to list keys missing from storage. Files are checked per organisation (hard rule 8), so a restored bucket is not shared with another environment.
* Drill: once per quarter, restore a sample (say 100 random objects including the largest) from the second location and compare checksums.

## 5. Targets (proposed, for Given to confirm)

| Target | Proposal | Reasoning |
|---|---|---|
| RPO, database | 24 hours with nightly dumps; 15 minutes if WAL archiving is on | V1 is a CRM, not a ledger; payments are recorded in the CRM but money moves elsewhere. A day of lost edits is painful but recoverable by re-entry. The 15 minutes follows the archive interval (`archive_timeout = 300`, plus transfer). |
| RPO, files | 24 hours (nightly copy); versioning covers deletes | Same reasoning. |
| RTO, database | 1 hour to a working app on a prepared host | Measured restore of the developer database is seconds (section 7) and the rehearsal database restored in 4 s; the rest of the hour is people: decide, provision or point to a host, run roles, migrate, smoke test, switch the connection string. Size changes the restore term, so the staging drill replaces the developer figure. |
| RTO, files | 4 hours | The app works without old attachments; copying back is a background job. |

Confirmed numbers go in `docs/DECISIONS.md` (lead to add) and replace "proposed" here.

## 6. Encryption and access

* Dumps are encrypted before they leave the host: `age` or `gpg` with a public key (`pg_dump ... | age -r <public key> > file.dump.age`). Only the recovery key holders (two named people, key kept offline and in the secret store, not on the backup storage) can decrypt. Test decryption in the drill.
* Storage encryption at rest is switched on as well, and transport is TLS only.
* Write access to the backup location belongs to the backup job only; it cannot delete or overwrite (object lock or versioning). Read access is limited to the recovery key holders and the drill. Backups use a separate credential from the application's.
* Backups contain every tenant's data including masked fields (deal values, payments): treat them as the most sensitive thing we hold. Never restore into a shared environment; never restore production data onto a laptop. Staging gets anonymised data through the guarded refresh in the staging runbook, not a raw restore.
* Never paste a connection string or password into a ticket or log. The drill script prints only table names, counts and timings.

## 7. Restore procedure (into a scratch environment)

Never restore over a live database.

1. Fetch and decrypt the chosen dump onto the scratch host.
2. Create an empty database: `createdb figbloom_restore_<date>`.
3. `pg_restore --no-owner --no-privileges -d figbloom_restore_<date> <file>.dump`
4. Run `npm run db:bootstrap-role` and `npm run db:grant-role` against it (`APP_DB_PASSWORD` from the secret store).
5. If the dump is from an older release: `npm run migrate:deploy`.
6. Verify: row counts per table against the source or the backup log, row-level security enabled with all policies, the cross-organisation test passes, then a login and a smoke run. The script below does steps 2, 3 and the checks for you.
7. For production recovery only: stop the app, take a dump of the broken database first (evidence), swap the connection string to the restored database, start the app, run the smoke suite.

### The scripted drill

`scripts/backup-drill.ts` dumps a database, restores it into a throwaway scratch database on the same server, compares the row count of every table, confirms row-level security (enabled and forced flags) and every policy are present, drops the scratch database and prints timings. It exits non-zero on any difference. It never prints row data or the connection string.

```bash
# DATABASE_URL is the owner connection, as for db-admin.ts
npx tsx scripts/backup-drill.ts [source-database]
# with Docker Postgres and no local pg_dump:
BACKUP_DRILL_DOCKER_CONTAINER=figbloom_crm_postgres npx tsx scripts/backup-drill.ts
```

Needs `pg_dump`/`pg_restore` on PATH (version equal to or newer than the server) or the container variable. `BACKUP_DRILL_KEEP=1` keeps the scratch database. Run it with `npm run backup:drill`.

Limits: it proves the logical dump restores with data, RLS and policies intact. It does not test decryption, storage download, files, WAL replay, or the human steps; those belong to the staging drill.

### Measured results

On a developer machine, small data (Docker PostgreSQL 16, throwaway database of 2 tables, 200,050 rows, one RLS table with one policy, dump 475 KiB), two runs:

| Step | Run 1 | Run 2 |
|---|---|---|
| Dump | 0.9 s | 0.9 s |
| Restore | 1.6 s | 1.2 s |
| Verify (counts, RLS, policies) | 0.1 s | 0.2 s |
| Result | pass, all counts matched | pass, all counts matched |

For comparison, `docs/MIGRATION_REHEARSAL.md` restored the rehearsal database in 4 s, every table identical. These numbers are not an RTO. The timed drill on staging, with the real schema and a realistic volume and including download and decryption, is still to do (section 9).

### Staging-stack drill, 4 Nov 2026 (FIG-1125, FIG-1258 backup half)

**This is NOT a timed drill at production volume.** It rehearses the procedure on the real schema, on a developer machine (Windows 11, Docker Desktop, PostgreSQL in the `figbloom_crm_staging_postgres` container of the local staging stack, `docs/STAGING.md`). Data volume: the small seeded staging database, 73 tables, 693 to 739 rows in total (other work was using it during the drill), database size 15 MB, dump 439 to 443 KiB (custom format). Four other drills shared the Docker engine, so timings are noisy: restore of the same 440 KiB dump took between 14 s and 76 s. Read them as "seconds to about a minute at this size", not as an RTO.

Real schema: all migrations applied; 65 of 73 tables have row-level security enabled and forced (all 63 tables with an `organization_id` column, plus 2) and there are 64 policies. The 8 tables without RLS are global by design: `users`, `roles`, `permissions`, `role_permissions`, `password_reset_tokens`, `scheduled_job_runs`, `auth_rate_limit_attempts` (grants revoked from the app role instead) and `_prisma_migrations`.

`npm run backup:drill` with `BACKUP_DRILL_DOCKER_CONTAINER=figbloom_crm_staging_postgres`:

| Step | Run 1 | Run 2 | Run 3 | Run 4 |
|---|---|---|---|---|
| Dump | 2.2 s | 1.4 s | 2.2 s | 3.8 s |
| Restore | 14.3 s | 75.9 s | 21.8 s | 15.1 s |
| Verify (73 table counts, RLS flags, 64 policies) | 1.3 s | 4.1 s | 2.4 s | 2.2 s |
| Result | FAIL (see below) | pass | pass | pass |

Run 1 failed on `auth_rate_limit_attempts` (source 42 rows, restored 44): the source was live and rows were added between the count and the dump. That was a defect in the drill script, not in the restore. Fixed: the script now counts inside one `REPEATABLE READ` transaction and dumps with the exported snapshot (`pg_dump --snapshot`), so counts and dump describe the same instant. Runs 3 and 4 used the fixed script; run 2 (old script) passed by timing luck. In the passing runs every table count, every RLS flag (enabled and forced) and all 64 policies matched.

**The restored copy works** (scratch database, dropped afterwards). Dump and restore into a new database (1.1 s and 8 to 20 s), then the role steps above: `db:bootstrap-role` (2 to 4 s) and `db:grant-role` (2 to 4 s). Then connected as `figbloom_app` (not superuser, no BYPASSRLS):

| Check | Result |
|---|---|
| 63 tenant tables have RLS enabled and forced after restore | pass |
| No organisation set: every tenant table returns 0 rows (18 of them hold data) | pass |
| Two organisations (staging has one, so a second organisation and one company per organisation were added in the scratch copy only): A sees its row and not B's, B sees only its own, B cannot read A's organisation row | pass |
| Insert as B of a row belonging to A is refused by the policy | pass |

Corrections to this document: (1) `db:grant-role` works on the database named in `DATABASE_URL`, not on `APP_DB_NAMES`; `APP_DB_NAMES` only sets the `GRANT CONNECT` in `db:bootstrap-role` (default `figbloom_crm_dev,figbloom_crm_test`, which fails on a server without those databases). So step 4 means: bootstrap-role with `APP_DB_NAMES=<restored db>`, then grant-role with `DATABASE_URL` pointing at the restored database. (2) The drill script was not safe on a live source (fixed above). Nothing in the restore itself was wrong.

**Files.** The staging bucket (`figbloom-crm-staging`, private: anonymous access returns 403) was empty, so a 3 MB test object was written under `drill-1125/`, read back through the S3 API with signed requests, written again under a second key and read again: SHA-256 identical at every step, about 3 s for the four transfers; both objects were then deleted. This proves the signed S3 path and the checksum method only. Not tested: versioning and delete-marker recovery (section 4), the second-location copy, the orphan report against a restored database, volume.

**Erasure versus backups.** The point in section 2 holds in principle but is incomplete. `docs/PRIVACY.md` says nothing about backups and no replay tool exists. Erasure (`src/services/erasureService.ts`) removes the person but leaves an audit event `data_subject.erased` with a hash of the email and of the phone tail, salted with the organisation id (deterministic, not secret), for the first email and phone only. A replay after a restore is therefore possible (hash every restored contact the same way, erase the matches) but must be written, and it can only replay erasures that are in the restored database or in a copy of the log kept outside it: an erasure made after the dump exists only in the live audit log, which is lost in the very failure that causes a restore. Needed: an erasure log kept outside the database (hashes only), a replay script, a line in PRIVACY.md and in the P1.06 assessment. The 12-month monthly copies are the long pole for a maximum backup age under the Kenya DPA.

Not tested and still for a person: decryption of an encrypted dump (no keys exist yet), download from the real backup storage, a realistic volume, the human steps and the clock time of a real switch-over.

### Re-run on the rebuilt staging stack, 5 Nov 2026 (FIG-1125)

Same procedure, quiet machine, the current image and migrations. **Still small volume** (73 tables, 747 rows in the live database, dump 446 KiB, about 15 MB database), so read it as proof of the procedure and as "seconds at this size", not as an RTO at production volume.

| Step | Time |
|---|---|
| Snapshot of the source | 0.3 s |
| Dump (`pg_dump -Fc`) | 0.5 s |
| Restore into a scratch database | 4.7 s |
| Verify (72 table counts, RLS flags, policies) | 0.2 s |
| Dump plus restore | 5.3 s |
| Result | **PASS**: every table count matched, RLS and all policies present |

Two further runs of the same dump on the same day (the rollback proof in `docs/CUTOVER_PLAN.md`) restored in 8.1 s and 5.7 s to 10.5 s. Against the 1 hour database RTO in section 5 this leaves a wide margin at this size; the margin at real size is not measured. **Closed on the criterion "successful restore drill with measured times recorded here".** What remains true and is not a criterion of FIG-1125: automated nightly backups need a real host with a scheduler, backup storage and two key holders (section 9), and the volume drill belongs to the production rehearsal (FIG-1258).

## 8. Moving to AWS later

No AWS service decision is made here. The move is a dump and restore:

1. Provision PostgreSQL on AWS (any form that supports `pg_restore`, same major version or newer, region chosen in the P1.06 data-location assessment).
2. Freeze writes (maintenance window), take a final dump, `pg_restore` into the new server, run `db:bootstrap-role` and `db:grant-role`, compare counts and RLS with `backup-drill` logic against both sides.
3. Change the connection strings (`DATABASE_URL`, `APP_DATABASE_URL`) in the secret store; start the app; smoke test. Rollback is pointing back at the old server, which stays untouched and read-only until sign-off.
4. Object store: switch the storage adapter configuration to the new bucket, copy the objects across before the switch and again after the freeze, check key counts and checksums.
5. Re-point backups (schedule, encryption keys, retention) at the new host and run the drill there the same day.

## 9. What only a human can do

* Choose and provision the backup storage (and the second location for files) and the encryption keys and their two holders.
* Confirm the RPO and RTO targets and the retention schedule, and decide whether WAL archiving is needed.
* Run the timed drill on staging, record real numbers here, and run the file restore sample.
* Sign off the data-location side with the P1.06 assessment (erasure versus backup retention).
