# Migration guard and data-preservation checks (UC-F7)

Issue FIG-1771. Builds on FIG-1603 (P2-20, safe migrations), architecture doc section 18.5 and the audit section 10.
The CRM holds real data. A migration or a move must prove that nothing was lost or changed. This page says how.

Every command below prints **counts, sums, hashes, table and column names only**. None prints a row, a file name, a
connection string or a password. Every command connects as the schema **owner** (`DATABASE_URL`, or
`VERIFY_DATABASE_URL` to point one run at a restored copy without touching `.env`) and first checks that the role bypasses
row-level security, because a role held back by forced RLS would make every count partial (this is the UC-F6 question for AWS).

## The commands

| Command | What it proves | Exit 1 when |
|---|---|---|
| `npm run check:migrations` | No migration holds `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, `DELETE` without `WHERE`, `ALTER COLUMN TYPE` or a rename, unless it carries `-- migration-guard: approved-by=<name> reason=<why>`. | an unapproved destructive statement |
| `npm run verify:migration` | RLS on and forced for every tenant table, a policy on each, the app role's grants (open tables readable, the closed tables closed, no credentials readable), table counts against a snapshot. | any check fails |
| `npm run verify:relations` | Every foreign key, **including the 229 composite organisation-plus-id keys**, is validated and has zero orphan rows. | an orphan, a `NOT VALID` key, or no key found |
| `npm run verify:financials` | Per organisation and currency: invoices (active and void), payments (active and reversed), outstanding, quote totals, deal values by outcome. Every row of `invoices`, `payment_records`, `quotes`, `quote_versions`, `quote_lines`, `deals` and `recurring_services` goes into a hash (money is compared in full, not by sample). Internal checks: no negative amount, no payment without an invoice, no overpayment unless allowed, PAID invoices have nothing outstanding, quote subtotals equal their lines. | an internal check fails, or `--compare` finds any difference |
| `npm run verify:files` | Every non-purged File row (not still uploading) has its object, of the recorded size, with a matching `checksum_sha256`; objects with no row are reported. **Local storage driver only**: the s3 driver is reported as not supported, not passed. | a missing object, a wrong size or checksum (orphans only with `--fail-on-orphans`) |
| `npm run verify:duplicates` | No repeated natural key (user email ignoring case, invoice and quote numbers per organisation, memberships, custom-field definitions) and every index valid and ready. | a repeat, an invalid index, or a **missing table** |
| `npm run verify:custom-fields` | Per custom-field definition: how many rows carry the key and a hash of the values; stored keys with no definition. | an orphan key, or `--compare` finds any difference |
| `npm run verify:all` | Runs the above in turn. | any step fails |
| `npm run reconcile:counts` | (existing, FIG-1127) counts per table per organisation between a source and a target, plus a sampled content hash. | any difference |

## The snapshot flow (before and after)

A migration is never judged without a "before". `verify:migration` therefore **fails when it has no snapshot**, unless you
say this is only a health check with `--no-snapshot` (printed as SKIP).

```
# 1. On the source, before the change (owner connection, direct URL):
npm run verify:migration     -- --snapshot-out before-counts.json
npm run verify:financials    -- --out before-money.json
npm run verify:custom-fields -- --out before-cf.json

# 2. Make the change (migrate:deploy:direct then db:grant-role) or the move (dump and restore).

# 3. On the target:
npm run verify:migration     -- --snapshot before-counts.json            # nothing disappeared, nothing lost rows
npm run verify:migration     -- --snapshot before-counts.json --exact    # a like-for-like move: every count EQUAL
npm run verify:relations
npm run verify:financials    -- --compare before-money.json
npm run verify:duplicates
npm run verify:custom-fields -- --compare before-cf.json
npm run verify:files         -- --root <objects dir> --checksum all
```

* `--snapshot` alone uses "fewer rows fails": **extra rows pass**, which is right after a migration that seeds data. For a
  restore or a copy use `--exact`; new tables also fail then.
* `--compare` compares every value as exact decimal text or hash, so "to the cent" means identical. A failing compare
  names the keys that differ (`money|<org>|KES|invoiceAmount`, `hash|invoices|<org>`) and never the values.
* The `--out` files hold counts, sums and hashes only. They are safe to keep with the release evidence.
* `verify:files --checksum 200` (the default) hashes the 200 rows with the smallest `md5(id)`, the same rows on both sides of a move;
  use `--checksum all` for signed and legal documents.
* Run against a **restored copy** first. Never rehearse against the live database.

## What the closed tables are

`verify:migration` used to demand SELECT on every table and so failed on a healthy database. The app role is deliberately kept out
of the platform, two-step, rate-limit, reset-token and lifecycle tables. They are listed in
`scripts/lib/appRoleRestrictedTables.ts` and checked in both directions: each must be closed, and nothing else may be. A test
(`tests/dataVerifyDb.test.ts`) compares that list with the real database after `db:grant-role`, so a new closed table, or a lost grant,
fails the suite until the list is updated. `users` is column-limited and has its own check (UC-F3).

## The guard

Migrations applied before the guard existed are listed in `prisma/migrations-guard-baseline.json` and are not judged. A new migration
that needs a destructive statement must carry the approval line **written by the person who approved it**:

```
-- migration-guard: approved-by=Given reason=drop of the unused tickets tables, data exported first
```

The default is expand and contract: add first, switch, drop in a later release (`docs/BACKUP_RESTORE.md` section 10).

## CI

The `migration-safety` job in `.github/workflows/ci.yml` (part of the aggregate `ci` check) runs the guard, proves the guard
refuses a probe migration that drops a column, applies every migration to a fresh database, seeds it, takes the before snapshot and
fingerprints, applies the migrations a **second time** (it must report "No pending migrations"), and then verifies with `--exact`.

## What this does not cover yet

* A restore of **real data**: this was rehearsed on a copy of the seeded development database only. UC-F8 repeats it on a restored
  copy of the live database and needs a read-only connection from Given.
* `verify:files` for the s3 driver (the production bucket, P2-04).
* Duplicate **attribution** rows: no attribution table exists until UC-C8; the check is skipped (printed SKIP) while there is none, and
  **fails** once one exists until its key is added to `scripts/lib/dataVerifyDb.ts`.
* The seed has no invoices or payments, so the money checks are proven by `tests/dataVerifyDb.test.ts` (which creates them), not by seed data.
* Platform audit chain (`npm run audit:anchor -- check --database`), tenant isolation (`tenantAttack*`) and the full suite are separate
  gates in architecture doc 18.5 and are not wrapped here.
