# Migration rehearsal: V0 database to V1 (G1.07, FIG-1074)

A rehearsal of the production upgrade, run on a copy, so the real one holds no surprises. Run on 26 Oct 2026 against a database built from the **`pre-makeover` tag** (the V0 application as it was before the makeover: its own 17 migrations and its own seed), filled to production-shaped volume, then upgraded to the current schema.

Repeat it any time with:

```
OLD_TREE=<folder holding `git archive pre-makeover` extracted, after `npm ci`> npx tsx scripts/migration-rehearsal.ts
REHEARSAL_PRE_INDEX=1 ... same command ...      # with the mitigation described under "Finding 1"
```

It creates and drops its own databases (`figbloom_crm_rehearsal_old`, `figbloom_crm_rehearsal_up`) and never touches dev, test or the scale database. The raw numbers go to `migration-rehearsal.json` (git-ignored).

## What was rehearsed

| Step | Result |
|---|---|
| Old database: V0 migrations, V0 seed, then volume | 1 organisation, 5 users and memberships, 2,000 companies, 5,000 contacts, 12,000 leads, 3,500 deals, 40,000 activities, 8,000 tasks, 8,000 communications, 8,000 notifications (86,740 rows, 35 tables). About a quarter of the G1.04 scale; invented data only. |
| Backup (`pg_dump -Fc`) | 1.0 s, 5.8 MB |
| Restore into a fresh database | 4 s. **Every table identical to the original** (row count and a hash of every row's columns). |
| Upgrade the restored copy: 34 new migrations | 14 s as shipped, 6 s with the mitigation (below). No migration failed. |
| Grants, role and permission catalogue, backfill of organisation defaults | Run, then run again: the second run changes nothing. |
| Old data after the upgrade | **No row lost or changed, no old column or table gone.** 31 of 35 tables identical. The other 4 are the ones that are meant to change: `roles` (+1 new role, 5 descriptions updated), `permissions` (+26), `role_permissions` (+50, 2 removed: the catalogue is reconciled to the code on purpose), `audit_events` (+5, the reconcile writes its own audit rows). |
| Row-level security | 63 tables carry an `organization_id`; **all 63 have RLS enabled and a policy.** |
| Read through the app's own database role | 12,000 leads, 5,000 contacts, 3,500 deals, 40,000 activities: the same counts as the old database. |
| Constraints | No constraint left unvalidated. |
| Rollback (restore the backup over the upgraded copy) | 4 s. Identical to the pre-upgrade database, migrations table back to 17. |

During the upgrade a probe read and wrote a lead and a deal every 25 ms to measure how long the app would stall. No probe failed (0 errors in about 300 probes).

## Findings

### 1. The deal-rules migration locks `deals` for about 9.5 seconds at this size (and grows quickly with the data)

`20261023230000_deal_rules` adds `deals.last_activity_at` and fills it with one subquery per deal against `activities` and `communications`. The only index those tables have on the deal is `(organization_id, deal_id, occurred_at)`, and the subquery filters by `deal_id` alone, so the index cannot be used and **every deal scans every activity**. At 3,500 deals and 40,000 activities that is 9.5 s, while the migration holds an exclusive lock on `deals` (any write to a deal waits; measured worst wait **9,491 ms**). The cost grows with deals times activities, so a database five times bigger would not take five times as long.

| | Whole upgrade | `deal_rules` migration | Worst wait for a write |
|---|---|---|---|
| As shipped | 14.2 s | 9.5 s | 9,491 ms |
| With the two temporary indexes below, created first | 5.8 s | 0.7 s | 681 ms |

**Mitigation that needs no change to any migration** (tested, `REHEARSAL_PRE_INDEX=1`): before `migrate deploy`, run

```
CREATE INDEX upgrade_tmp_activities_deal ON activities (deal_id);
CREATE INDEX upgrade_tmp_communications_deal ON communications (deal_id);
```

and drop both once the upgrade has finished. Either way, run the real upgrade in a quiet window.

**Decision for Given:** the cleaner fix is to add `AND a.organization_id = d.organization_id` (and the same for communications) inside that migration, so the existing index serves it. The result is identical and only the speed changes, but the migration is already merged to `dev-given` and has been applied on dev and test databases, so editing it is a change to history. I have not touched it. If you want it changed, say so; otherwise the runbook above is enough for a database this size.

### 2. `seedOrganizationDefaults` must not be re-run on an existing organization

It is documented as safe to call on every deploy, but it rewrites the name and order of every status, source, stage, lost reason, service and lifecycle state back to the catalogue, which would undo anything an organization renamed in its settings (and it touches `updated_at` on every row, which is how the rehearsal noticed). Nothing runs it on deploy today (it runs when an organization is created), so no data is at risk now, but a future "run it at upgrade" would have been destructive.

Fixed: `seedOrganizationDefaults(organizationId, { fillOnly: true })` creates what is missing and changes nothing that is there, and `scripts/backfill-organization-defaults.ts [slug]` runs it for every organization and prints how many rows it added. `tests/organizationDefaultsBackfill.test.ts` covers it (a renamed stage and service stay as left, a missing row is put back, a second run adds nothing, provisioning still resets).

The rehearsal showed the V1 catalogue holds the same statuses, sources, stages, reasons and services as V0, so for an existing organization the backfill adds only the qualification questions.

## Upgrade runbook (what to do on the day)

1. Tell people the CRM is read-only for a few minutes. Take a backup: `pg_dump -Fc -f before-v1.dump <database>` (keep it until the release is signed off; it is also the rollback).
2. Optional but recommended for a database with more than a few thousand deals: create the two temporary indexes above.
3. `npm run migrate:deploy` (34 migrations, about 6 to 14 s at the rehearsal size).
4. `npm run db:bootstrap-role` and `npm run db:grant-role` (the app role needs privileges on the new tables).
5. `npm run seed`: the production-safe seed. It only reconciles the role and permission catalogue (no organization, user or sample data).
6. `npx tsx scripts/backfill-organization-defaults.ts` (adds the starting qualification questions; changes nothing else).
7. Drop the temporary indexes if step 2 was used.
8. Check: sign in as a Management user, open Leads, Deals and Customer 360, and compare the lead and deal counts with the pre-upgrade numbers.
9. **Rollback** if anything is wrong: stop the app, restore the dump into an empty database (`pg_restore --no-owner -d <database> before-v1.dump`), start the previous version. Migrations only go forward; the backup is the way back, and the rehearsal proved it restores byte-for-byte identical data (4 s here).

## What this does not prove

- The volume is a quarter of the G1.04 scale and invented. A real production database may be bigger or shaped differently. Finding 1 is the one place where size changes the answer; re-run the rehearsal on a copy of the real data (same command, point it at a restored dump) before the go-live if there is any doubt.
- The probe touches one lead and one deal, so it shows lock waits on those tables, not every table. The migrations that take a lock on a big table are `deal_rules` (deals, finding 1), `archive_semantics` (about 1 s) and the index builds in `fk_indexes_for_deletes`; none of the others took more than a third of a second.
