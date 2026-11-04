# Production cutover plan (FIG-1127, P1.05; cutover and rollback half of FIG-1258, P1.14)

How the CRM goes live on its production database, and how we get back if it goes wrong. Plain PostgreSQL, local for now, AWS later (Michael, 4 Nov 2026); nothing here depends on a vendor service. Numbers come from the rehearsals in `docs/MIGRATION_REHEARSAL.md` and the section "Rehearsal results, 4 Nov 2026" below (about a quarter of the G1.04 scale, invented data); they must be re-measured on the real copy (step R below).

Backup, restore drill and retention: `docs/BACKUP_RESTORE.md` (written separately). This plan only says when to take the backup and when to use it.

## 0. Open questions (Given must answer before this plan can be signed)

Nothing in the repository says whether any real data exists. The plan covers both cases; the answers pick the path.

**Working assumption since 4 Nov 2026 (`docs/DECISIONS.md` 6.2): Path A, a fresh organisation with no data to migrate.** If real data does exist, say so and Path B applies, with the rehearsal on a copy passing before go-live.

1. **Is there real data to carry over?** Path A (fresh organisation) or Path B (existing system or V0 database).
2. **If yes, where does it come from?** (a) The V0 database (the `pre-makeover` application), upgraded in place or from a restored dump; (b) spreadsheets or another system, imported through Settings > Data migration (`docs/DATA_MIGRATION.md`). Which record kinds, and roughly how many rows of each?
3. **Who approves the freeze and the go decision?** Named person and a deputy (proposal: Michael approves, Given runs it).
4. **When is the window?** Proposal: an evening or weekend, outside the sales team's working hours, with the day after kept free for watching.
5. **Who tells the users, and through which channel?**
6. **Is a real production database already provisioned** (host, disk, backups)? The plan assumes a PostgreSQL the app role can reach, with the schema-owner URL kept out of the app's environment.

## 1. Two paths

| | Path A: fresh organisation | Path B: existing data |
|---|---|---|
| Data to move | None | V0 database (in-place upgrade), or files through the data migration wizard |
| Freeze window | None for data; a short "no sign-ups yet" period while checks run | Needed: from the last backup to the end of reconciliation |
| Migrations | `migrate:deploy` on an empty database | Upgrade of the existing database (section 4) |
| Reconciliation | Not needed (nothing to compare); run the smoke suite | `scripts/reconcile-counts.ts` against the rehearsal copy and the pre-cutover backup |
| Rollback | Drop and recreate the database, or restore the pre-cutover backup (it is empty) | Restore the pre-cutover backup (section 7) |

**Path A in short:** create the empty database and roles, `npm run migrate:deploy`, `npm run db:bootstrap-role`, `npm run db:grant-role`, `npm run seed` (production-safe: roles and permissions only), create the organisation and its first Management user through the normal provisioning, then the go/no-go checks in section 5. Never run `seed:dev` (it refuses under `NODE_ENV=production`).

**Path B** is the rest of this document. If the data comes from files rather than a V0 database (Path B2), the cutover is Path A followed by the data migration wizard: import companies, then contacts, then leads, deals, tasks and activities, each with a dry run, and reconcile the imported counts against the row counts of the source files (the wizard's session counts, plus `GET .../issues`). The 72-hour wizard rollback (`MIGRATION_ROLLBACK_WINDOW_HOURS`) is an extra safety net for imports, not a replacement for the backup.

## 2. Timings (from the rehearsals, 86,740 rows; the 4 Nov 2026 runs are in "Rehearsal results, 4 Nov 2026" below)

| Step | Rehearsal, 26 Oct (idle machine) | Rehearsal, 4 Nov (staging PostgreSQL, busy machine; range of 6 runs) | Plan for the real size |
|---|---|---|---|
| `pg_dump -Fc` | 1.0 s, 5.8 MB | 1.0 to 1.9 s, 5.8 MB | Measure on the copy (R) |
| Restore into an empty database | 4 s | 3.7 to 12.1 s | Measure on the copy |
| Upgrade, 34 migrations, as shipped | 14.2 s (deal rules 9.5 s) | 24.9 to 49.6 s (deal rules 12.6 to 21.0 s; worst write wait 12.5 to 20.9 s) | Not used: use the temporary indexes |
| Upgrade with the two temporary indexes | 5.8 s (deal rules 0.7 s; worst write wait 681 ms) | 9.8 to 25.1 s (deal rules 0.4 to 1.1 s; worst write wait 362 to 1,010 ms) | Measure; the cost grows with deals times activities |
| Grants, seed, backfill | seconds | 3 to 11 s per step (bootstrap role, grant role) | seconds |
| Reconciliation (`reconcile-counts`) | not run | 4.8 to 6.3 s | Measure |
| Rollback (restore over the upgraded copy) | 4 s | 4.1 to 22.7 s | Measure |

The 4 Nov runs shared the computer with four other jobs, so the absolute seconds are noisy (the same step varied up to fivefold between runs); the ratio is the reliable result: the deal-rules migration is 12.6 to 21 s without the temporary indexes and about 1 s with them, and the write stall drops from 12 to 21 s to about 1 s or less.

**Freeze window:** the rehearsal total is well under a minute of machine time. Plan **60 minutes** for Path B (freeze to unfreeze), made of: 10 min announce and freeze, 5 min backup and verify, 15 min upgrade and steps, 10 min reconciliation, 15 min go/no-go checks, 5 min unfreeze. Set a hard stop at **40 minutes after the freeze begins**: if section 5 has not passed by then, roll back (section 7). Re-size after the real-copy rehearsal.

## 3. Rehearsal (R): before the real day

Repeat on a restored copy of the real data (or, if none exists, on the rehearsal database), on the staging environment from FIG-1123:

1. Restore the latest production dump into a scratch database.
2. Time steps 3 to 9 of section 4 against it (with the temporary indexes), and the rollback.
3. Run `scripts/reconcile-counts.ts` between the scratch copy before and after the upgrade (see section 6). Acceptance: zero differences apart from the tables that are meant to change (the rehearsal list: `roles`, `permissions`, `role_permissions`, `audit_events`, plus tables new in the target).
4. Record the timings in this document, then run the smoke suite on staging.

## 4. Cutover steps (Path B, in order)

Run from a machine that can reach the production database with the schema-owner URL. Never paste a password into a command line or a log: set `DATABASE_URL` from the secret store for the session.

1. **Announce and freeze.** Tell users the CRM is read-only from the agreed time. Put the app in maintenance (read-only) mode or stop the app and its jobs (job framework workers too: no background import, no sync pushes). Note the time.
2. **Pre-cutover backup.** `pg_dump -Fc -f before-v1.dump <database>`; verify with `pg_restore --list before-v1.dump` and record size and checksum. Take row counts for the baseline: `npx tsx scripts/reconcile-counts.ts` needs two databases, so restore the dump into a scratch database now (4 s here) and keep it as the SOURCE for step 9. Keep both until sign-off. See `docs/BACKUP_RESTORE.md`.
3. **Temporary indexes** (recommended above a few thousand deals; always when the real size is unknown), for the deal-rules migration `20261023230000_deal_rules`:
   ```
   CREATE INDEX upgrade_tmp_activities_deal ON activities (deal_id);
   CREATE INDEX upgrade_tmp_communications_deal ON communications (deal_id);
   ```
4. `npm run migrate:deploy` (34 migrations on a V0 database).
5. `npm run db:bootstrap-role` and `npm run db:grant-role` (the app role needs privileges on the new tables).
6. `npm run seed` (production-safe: role and permission catalogue only).
7. **Backfill:** `npx tsx scripts/backfill-organization-defaults.ts`. Adds the missing starting rows (qualification questions); changes nothing else. Do not call `seedOrganizationDefaults` without `fillOnly`.
8. **Drop the temporary indexes:** `DROP INDEX upgrade_tmp_activities_deal; DROP INDEX upgrade_tmp_communications_deal;`
9. **Reconcile** (section 6).
10. **Go/no-go** (section 5). Deploy the new app version, run the smoke suite against production.
11. **Unfreeze** and announce. Keep the pre-cutover dump and scratch copy until the release is signed off.

## 5. Go / no-go checks (all must be yes; any no means roll back)

- Every migration applied, none failed, `prisma migrate status` clean.
- Reconciliation: zero unexplained differences (counts and spot check).
- Row-level security: every table with `organization_id` has RLS enabled and a policy (the rehearsal check, 63 tables); the app role reads through RLS and sees the same lead, contact, deal and activity counts as before.
- Sign in as a Management user: Leads, Deals, Customer 360 open; counts match the baseline. Sign in as a Sales user: deal values masked where the role requires it; Payments visible only to Finance and Management.
- No dev account exists (production boot check) and `ALLOW_DEV_ACCOUNTS` is not set.
- Frozen auth pages unchanged (visual regression guard green on the released build).
- Smoke suite green against production; error rate and slow queries quiet for 15 minutes after unfreeze.
- Backup of the new state taken after go (becomes the first scheduled-backup baseline).

## 6. Reconciliation (zero differences)

`scripts/reconcile-counts.ts` compares a SOURCE and a TARGET database, never prints row contents or secrets, and exits 1 on any difference.

```
RECONCILE_SOURCE_URL=<pre-cutover scratch copy URL> RECONCILE_TARGET_URL=<upgraded database URL> \
  npx tsx scripts/reconcile-counts.ts --ignore audit_events,roles,permissions,role_permissions
npx tsx scripts/reconcile-counts.ts --org <slug> --sample 1000     # one organisation, bigger sample
npx tsx scripts/reconcile-counts.ts --no-sample                    # counts only
```

- **Counts:** every public table, per organisation (global tables once). Differences are listed as `source N, target M`.
- **Spot check:** for every table with an `id`, the 200 ids (default; `--sample`) with the smallest `md5(id)` are taken from the source (so the same rows every run) and each row is compared by content hash with the target. Columns that exist on one side only (new columns after the upgrade) are left out of the hash and listed as notes.
- **Tables meant to change** in a V0 upgrade: `roles`, `permissions`, `role_permissions`, `audit_events` (the reconcile writes its own audit rows). Tables new in V1 (37 of them on a V0 upgrade) exist only in the target and are reported as `exists on target only`: they are not an error, but check that they are empty apart from what the backfill and seed write (the rehearsal check: only `custom_field_definitions`, 32 rows per organisation, is not empty). Anything else that differs is a no-go. Note that the plain command exits 1 on a V0 upgrade because of these expected lines (42 differences in the rehearsal, all explained below); the go/no-go reads the list, not only the exit code.
- **Path B2 (files):** compare the wizard's per-session counts (created, updated, skipped, failed) with the row counts of the source files; failed rows must be zero or explained in the error report.
- Use the schema-owner URL (not the app role) so row-level security does not hide rows.

## 7. Rollback (restore the pre-cutover backup)

Migrations only go forward; the backup is the way back. Decision point: any "no" in section 5, or the 40-minute stop. Anyone with the freeze authority can call it.

1. Stop the new app and jobs (keep the freeze).
2. Create an empty database and restore: `pg_restore --no-owner -d <empty database> before-v1.dump`; re-run `npm run db:grant-role`. Procedure and verification: `docs/BACKUP_RESTORE.md`.
3. Point the previous app version at it (connection string back to the restored database), start it.
4. Verify: migrations table back to 17 (V0), baseline counts as recorded in step 2, sign-in works. The rehearsal proved the restore returns identical data (4 s).
5. Unfreeze, announce, and write down what failed. Nothing written after the freeze exists (the freeze means no writes were lost); if writes did happen after the unfreeze, do not roll back by restore without Given's decision: they would be lost.
6. Do not delete the failed upgraded database until the cause is known.

Rollback is proven when the rehearsal restores over an upgraded copy and `reconcile-counts` against the original shows zero differences: run it as part of R.

## 8. Communication points

| When | Who tells whom | What |
|---|---|---|
| 3 days before | Given to all users | Date, window, read-only period, what changes |
| 1 day before | Given to all users | Reminder; finish open edits |
| Freeze start | Given to all users | CRM is read-only now |
| Backup verified | Operator to Given and Michael | Backup size, checksum, baseline counts |
| Go / no-go | Operator to Michael | Result of section 5; decision recorded in the sign-off table |
| Unfreeze | Given to all users | Live; where to report problems; known differences |
| Rollback (if used) | Given to all users | What happened, current state, next date |
| Day after | Operator to Given | Error and slow-query review; backup after go taken |

## 9. Moving to AWS later

A planned move of the same plain PostgreSQL, no change to the application schema. This section lists the mechanics only; the AWS design (region, service choices, processor agreement) belongs to the data-location assessment in FIG-1258 and is not decided here.

- Same cutover shape: freeze, `pg_dump -Fc`, restore into the new PostgreSQL (same major version, or newer with a rehearsal), `db:bootstrap-role`, `db:grant-role`, reconcile with `scripts/reconcile-counts.ts` (old database as SOURCE, new as TARGET: zero differences expected, nothing meant to change), then switch.
- New connection strings: `DATABASE_URL` (schema owner, for migrations and jobs) and `APP_DATABASE_URL` (the `figbloom_app` role) in the environment of the app; rotate the app role password at the move. Connection strings live in the secret store, never in the repository.
- Files and signed URLs: the object store setting is switched separately; copy the objects first and compare counts per organisation before switching.
- Rollback for the move: keep the old database read-only and untouched until sign-off; switching the connection strings back is the rollback.
- Rehearse once on a restored copy and record the timings, as in section 3.

## 9b. Rehearsal results, 4 Nov 2026

Real run of `scripts/migration-rehearsal.ts` (FIG-1127, P1.05), not a paper exercise. Six complete runs, 4 Nov 2026, on the local staging PostgreSQL (container `figbloom_crm_staging_postgres`, port 35432, owner connection; scratch databases `figbloom_scratch_1127_old` and `_up`, dropped afterwards; the staging database itself was not touched). The V0 side was built from the `pre-makeover` tag extracted with `git archive` (17 migrations, V0 seed, V0 application code), then upgraded with the 34 current migrations (51 in total).

**Data volume, stated honestly: invented, 86,740 rows in 35 tables (1 organisation, 2,000 companies, 5,000 contacts, 12,000 leads, 3,500 deals, 40,000 activities, 8,000 tasks, 8,000 communications, 8,000 notifications), about a quarter of the 50k-lead scale (G1.04) and shaped by a generator, not by real use.** It proves the mechanics, the order of steps, the rollback and the zero-difference acceptance; it does not prove timings or content for real data. **A rehearsal on a copy of real data is still required if real data exists (Path B), and Given must say whether it does (question 1).** Under Path A (fresh organisation) there is nothing to migrate and this rehearsal is a proof of the tooling only.

| Run | Temporary indexes | Reconcile | Backfill step | Upgrade total | Deal-rules migration | Worst write wait | Outcome |
|---|---|---|---|---|---|---|---|
| 1 | no | not yet in the script | in-process | 49.6 s | 21.0 s | 20,949 ms | pass |
| 2 | yes | not yet in the script | in-process | 25.1 s | 1.1 s | 1,010 ms | pass |
| 3 | no | yes | in-process | 25.1 s | 13.4 s | 13,333 ms | pass |
| 4 | yes | yes | in-process | 9.8 s | 0.4 s | 362 ms | pass |
| 5 | yes | yes | `scripts/backfill-organization-defaults.ts`, twice | 17.4 s | 0.4 s | 382 ms | pass |
| 6 | no | yes | in-process | 24.9 s | 12.6 s | 12,541 ms | pass |

Other timings over the six runs: backup 1.0 to 1.9 s (5.8 MB); restore 3.7 to 12.1 s; rollback (restore over the upgraded copy) 4.1 to 22.7 s; each reconciliation 4.8 to 6.3 s; migration deploy for the V0 side 15 to 26 s. The machine was shared with other jobs, so single numbers are noisy; the repeatable result is the deal-rules effect: as shipped it holds a lock on `deals` for 12.6 to 21 s at this size; with the two temporary indexes it is 0.4 to 1.1 s and the worst write wait is 1 s or less. No probe failed in any run (0 errors in 600 to 1,437 probes of 25 ms). The decision on editing the deal-rules migration (finding 1 in `docs/MIGRATION_REHEARSAL.md`) is still Given's; the temporary indexes remain the plan.

**Checks, identical in all six runs:**

- Restore of the backup is identical to the original on every table (row count and hash of every row).
- Old data after the upgrade: 31 of 35 tables identical; no row lost or changed, no old column or table gone. The four tables that changed are the ones meant to: `roles` (+1 role, 5 modified), `permissions` (+26), `role_permissions` (+51, 2 removed), `audit_events` (+5).
- Row-level security: 63 tables with `organization_id`, 63 with RLS and a policy; the app role reads 12,000 leads, 5,000 contacts, 3,500 deals and 40,000 activities, the same as the old database; no unvalidated constraint.
- Backfill (`scripts/backfill-organization-defaults.ts`, run 5): first run `figbloom: 32 custom_field_definitions`, second run `figbloom: nothing to add`. Nothing else is added for a V0 organisation. (The V1 catalogue is the same as V0 for statuses, sources, stages, reasons and services.)
- Rollback: restoring the pre-upgrade dump over the upgraded copy gives a database identical to the original, with the migrations table back at 17 rows, and the V0 application's own code (counts, a list, a rolled-back write through its app role) works on it.

**Reconciliation (`scripts/reconcile-counts.ts`, runs 3 to 6; source = pre-upgrade database, target = upgraded copy, schema-owner URL, 35 tables compared, 1,735 rows spot-checked by content hash):**

After the upgrade it exits 1 with 42 differences, all explained, none unexplained:

| Difference | Count | Explanation |
|---|---|---|
| `audit_events [figbloom]`: source 0, target 5 | 1 | The permission reconcile writes its own audit rows (intended). |
| `permissions`: 59 to 85; `role_permissions`: 105 to 154; `roles`: 5 to 6 | 3 | The role and permission catalogue is reconciled to the code on purpose: +26 permissions, +51 and -2 role grants (net +49), +1 role (Customer Support). Intended. |
| `roles`: 5 sampled rows differ (content) | 1 | The 5 existing roles' descriptions were updated by the same reconcile. Intended. |
| `exists on target only` | 37 | Tables new in V1 (attachments, automation_rules, background_jobs, comments, files, invoices, payment_records, tags, and so on). All are empty after the upgrade except `custom_field_definitions` (32 rows, written by the backfill), which the rehearsal now measures (`newTableRows` in the result file, run 6). Intended. |
| Total | 42 | |

The shared tables otherwise match: rows counted 86,740 in the source and 86,821 in the target (+81 = 5 audit + 26 permissions + 49 net role grants + 1 role), and every sampled row of every shared table other than `roles` has the same content hash. Columns new in V1 on existing tables (for example `deals.last_activity_at`, `leads.score_value`, `companies.custom_fields`, `sessions.device_label`) are listed as notes and left out of the hash. After the rollback the same command exits 0: "reconciled, zero differences" (35 tables, 86,740 rows on both sides, 1,735 spot-checked), which proves the rollback.

**Result: PASS.** Upgrade, post-upgrade steps, reconciliation (zero unexplained differences) and rollback all work on the staging PostgreSQL, with and without the temporary indexes.

### Rollback proof on the live staging database, 5 Nov 2026 (FIG-1127, and part 2 of the rollback dry run for FIG-1126)

The same steps as section 7, done with the tools inside the staging PostgreSQL container (`docker exec figbloom_crm_staging_postgres`, so no tools were needed on the host) on the real staging database `figbloom_crm_staging` (73 tables, 747 rows; the live database was only read):

| Step | Result |
|---|---|
| 1. Pre-cutover backup (`pg_dump -Fc`), checked with `pg_restore --list` | 1.2 s, 446 KiB, 1,012 catalogue entries |
| 2. Restore into a scratch database (the "upgraded copy") | 8.1 s |
| 3. `reconcile-counts` live against scratch | 72 tables, 747 rows each side, 593 rows spot-checked: **zero differences**, exit 0 |
| 4. Damage the copy (delete all 33 `sessions` rows), reconcile again | detected: `sessions` source 33, target 0, 33 sampled rows missing, exit 1 |
| 5. **Rollback**: drop the damaged database, restore the backup into an empty one | 5.7 s |
| 6. `reconcile-counts` again | 747 rows each side, 593 spot-checked: **zero differences**, exit 0 |
| 7. Clean-up | scratch database and dump removed |

Rollback is therefore proven on the staging PostgreSQL itself, as well as in the six earlier rehearsals above, and the reconciliation script both finds damage and confirms its repair. **Still the same limits:** the data is small and invented (Path A: there is no production data, decision 6.2); the timings are for this size. A repeat on a copy of real data is required only if real data exists (Path B).

One operational finding: after Docker Desktop restarted, host connections to the published staging database port (35432) were refused until the PostgreSQL container was restarted. Anything that runs from the host (the staging scripts, `reconcile-counts`) needs that port working; in-container tools (`docker exec`) do not.

**Script changes made for this run (small):** `scripts/migration-rehearsal.ts` now accepts `REHEARSAL_DB_OLD` and `REHEARSAL_DB_UP` (names of the scratch databases, so it can share a PostgreSQL with other work), `REHEARSAL_RECONCILE=1` (runs `reconcile-counts` after the upgrade and after the rollback and keeps the output in the result file), and `REHEARSAL_BACKFILL_SCRIPT=1` (runs the shipped backfill script twice instead of the in-process call); it also counts the rows in tables new in V1. `PG_CONTAINER` was already supported and must name the PostgreSQL container (`figbloom_crm_staging_postgres` here). Set `APP_DATABASE_URL` with the real app role password: the rehearsal runs `bootstrap-role`, which sets that role's password, so a placeholder would change it on a shared PostgreSQL (here it was set to the same value, so nothing changed).

**What only a human can do:** (1) say whether real data exists (Path A or B, question 1); (2) if it does, provide a copy and have this rehearsal repeated on it (restore the dump into a scratch database, take it as the V0 side, upgrade, reconcile, roll back) and record the numbers here; (3) decide whether the deal-rules migration is edited (cleaner than the temporary indexes); (4) sign section 10.

## 10. Sign-off (left empty)

| Item | Name | Role | Date | Decision |
|---|---|---|---|---|
| Path chosen (A or B) | | | | |
| Window and freeze authorised | | | | |
| Rehearsal reconciled to zero differences, rollback proven | | | | |
| Plan approved | | | | |
| Go decision (day of cutover) | | | | |
| Cutover verified, release signed off | | | | |
