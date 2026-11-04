# Production cutover plan (FIG-1127, P1.05; cutover and rollback half of FIG-1258, P1.14)

How the CRM goes live on its production database, and how we get back if it goes wrong. Plain PostgreSQL, local for now, AWS later (Michael, 4 Nov 2026); nothing here depends on a vendor service. Numbers come from the rehearsal in `docs/MIGRATION_REHEARSAL.md` (about a quarter of the G1.04 scale, invented data); they must be re-measured on the real copy (step R below).

Backup, restore drill and retention: `docs/BACKUP_RESTORE.md` (written separately). This plan only says when to take the backup and when to use it.

## 0. Open questions (Given must answer before this plan can be signed)

Nothing in the repository says whether any real data exists. The plan covers both cases; the answers pick the path.

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

## 2. Timings (from the rehearsal, 86,740 rows)

| Step | Rehearsal | Plan for the real size |
|---|---|---|
| `pg_dump -Fc` | 1.0 s, 5.8 MB | Measure on the copy (R) |
| Restore into an empty database | 4 s | Measure on the copy |
| Upgrade, 34 migrations, as shipped | 14.2 s (deal rules 9.5 s) | Not used: use the temporary indexes |
| Upgrade with the two temporary indexes | 5.8 s (deal rules 0.7 s; worst write wait 681 ms) | Measure; the cost grows with deals times activities |
| Grants, seed, backfill | seconds | seconds |
| Rollback (restore over the upgraded copy) | 4 s | Measure |

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
- **Tables meant to change** in a V0 upgrade: `roles`, `permissions`, `role_permissions`, `audit_events` (the reconcile writes its own audit rows). Tables new in V1 exist only in the target: pass them in `--ignore` once you have confirmed they are empty in the source, or record them as explained. Anything else that differs is a no-go.
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

## 10. Sign-off (left empty)

| Item | Name | Role | Date | Decision |
|---|---|---|---|---|
| Path chosen (A or B) | | | | |
| Window and freeze authorised | | | | |
| Rehearsal reconciled to zero differences, rollback proven | | | | |
| Plan approved | | | | |
| Go decision (day of cutover) | | | | |
| Cutover verified, release signed off | | | | |
