# E2E data clean-up

Playwright specs sign in as the dev accounts and create real records (companies, deals, tasks, catalogue items, saved views, chat messages, an invited user) in the database the app runs on. Left alone they pile up in the dev database beside the seed data: "E2E Inline Co 1793961086320-4778" in the Leads list, a locked-out dev account (the login limiter counts every attempt), and settings the specs flipped.

Since 6 Nov 2026 a run removes what it made.

## What runs

| When | What | Where |
|---|---|---|
| Before the run | Deletes leftover test records by marker (an earlier run that was stopped halfway) | `e2e/support/global-setup.ts` |
| After the run | Deletes the run's test records, the settings and technical rows created during the run, and the `LOGIN` rate-limit rows | the teardown that `global-setup.ts` returns |
| By hand | `npx tsx scripts/e2e-cleanup.ts --since <time> --dry-run` (report, nothing deleted) or `--apply` | `scripts/e2e-cleanup.ts` |

All three use `e2e/support/cleanup.ts`. It never fails a run: if it cannot clean, it prints the command to run by hand. `E2E_SKIP_CLEANUP=1` turns it off.

## How a test record is recognised

Never "everything newer than X". A record is a test record when:

1. **It carries the marker**: its name, title, label, e-mail or message contains `E2E`, `e2e` or a 13-digit millisecond timestamp (`Date.now()`). Every spec makes its data unique this way. **Name what a new spec creates with `E2E` in it** (for example `` `E2E Quote Co ${Date.now()}` ``).
2. **It belongs to one**: leads, deals, tasks and contacts of a marked company or contact, and everything below them (invoices, payments, quotes, comments, activities, handoffs, attachments, audit lines, notifications) go through the database's `ON DELETE CASCADE`, or are deleted by id where no foreign key exists (audit events, notifications, sync mutations, record chat channels).
3. **Its own text names one**: a notification, an audit line or a merge snapshot that mentions `E2E` or an `e2e.` e-mail.

Only when the run's start time is known (the teardown, or `--since`) does it also remove, and only if created at or after that time: older spec names that had no marker (`LEGACY_NAMES`), settings the specs write and never restore (`session.lifetime_hours`, `privacy.retention`, `assistant.config`), the sales target, automation rule and website API key the specs add, the files and card captures they upload, idempotency keys, background-job history, and the `LOGIN` rate-limit rows. The website assignment cursor is put back to its seed value.

## What it does not touch

- Seed data and anything that does not match the above. Before deleting, the clean-up stops if a marked row is older than the start time (that would be seed data).
- Sessions, sign-in history and the `auth.login` audit lines: a developer's own Chrome and Playwright's look the same, so they cannot be told apart. They only grow; clear them by hand if the Security tab is noisy.
- Notifications the app generated about seed records (for example "Task overdue: ..." after the sweep ran).
- Files that uploads wrote to disk (`.data/files`); the rows are removed, the bytes are not.

## Safety

- Runs only against a database called `figbloom_crm_dev` or `figbloom_crm_test`, and never with `NODE_ENV=production` (hard rule 10). On any other database the setup says "skipped" and the specs run as before.
- One transaction: all or nothing. `--dry-run` runs the same statements and rolls back, and prints the rows per table.
- It prints table names and counts only, never a row's content or the connection string.
- The test for the marker, the guard and the statements is `tests/e2eCleanup.test.ts`.

## The login lock-out

The e2e server raises the login limit to 1000, but every attempt is still recorded, and the app on port 3000 (limit 5) counts the same rows. The teardown deletes the `LOGIN` rows created during the run, so the dev sign-in chips keep working after a run. If you are ever locked out: `npx tsx scripts/e2e-cleanup.ts --since <an hour ago> --apply`, or delete the `LOGIN` rows from `auth_rate_limit_attempts`.
