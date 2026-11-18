# Data migration (FIG-1061, B4.04, FIG-800)

The engine behind Settings > Data migration (S7), and how the real production data first gets in (P1.05). Management only (`configuration.manage`).

## The seven steps

| Step | Endpoint | What happens |
|---|---|---|
| 1 Source | `POST /data-migration/sessions` | Choose one kind of record: COMPANY, CONTACT, LEAD, DEAL, TASK or ACTIVITY; fixed template or generic mapper; duplicate policy |
| 2 Upload | `POST .../file` | A CSV or the first sheet of an .xlsx (stored as CSV). Answers with headers, row count and a suggested mapping. Warns if the same file was imported before |
| 3 Map | `PUT .../mapping` | Field to column; value mappings for statuses, sources, services, stages and owners (by email); save the mapping as a preset |
| 4 Validate | `POST .../validate` | Reads every row. Per-row errors and warnings; the values in the file the CRM does not know, with counts |
| 5 Dry run | `POST .../dry-run` | Decides what the import would create, update and skip, with a sample. Writes nothing |
| 6 Import | `POST .../import` | Needs a finished dry run and `confirm: true`. A background job; progress is on the session |
| 7 Review | `GET .../issues`, `GET .../errors` | Counts, per-row issues, the error report as CSV (the problem rows beside their original values), rollback |

`GET /data-migration/templates/{entity}` is the fixed template (header and one example row); its own headers map themselves.

## Rules

- **Nothing is silently defaulted.** A mapped value that does not exist (a stage, a status, an owner's email) is an error on that row, not a guess. An empty owner on a deal is an error; an
  unmapped owner column means "the person importing". A lost deal with no reason is recorded as Other, with a warning.
- **Good rows are kept** when others fail. A chunk that cannot be written is retried row by row, so one bad row costs one row.
- **Duplicates** (SKIP, UPDATE or CREATE) use the B2.04 normalisers: email (plus-addressing ignored), phone number (last nine digits), company name (legal words ignored); a lead
  duplicates an open lead for the same contact; a deal duplicates one with the same company, service, value, stage and close date. A row that repeats an earlier row of the same file is its
  duplicate. UPDATE fills in the fields the file carries and never blanks one. Tasks and activities have no natural key.
- **Every row created carries the session id** (`import_session_id`), and `import_session_changes` records what was done to each record.
- **No side effects.** An imported won deal starts no handoff, moves no lifecycle state, sends no notification, and an imported open deal counts as active from the day it arrives (so it is
  not stalled before anyone has seen it). Scores are recomputed by a job afterwards.
- **No cross-organisation reads or writes.** Everything a row can refer to is looked up inside the organisation.

## Rollback

Within a window (72 hours after the import, `MIGRATION_ROLLBACK_WINDOW_HOURS`), `POST .../rollback` removes what the session created, dependencies first, and puts back fields an UPDATE
changed. It never destroys what people did afterwards: a record edited since the import, one other records now depend on (a deal added to an imported company) and a field changed again are
kept, and the result counts them with the reason. Tags the import created are kept.

## Numbers (development database, Windows and Docker)

A 10,000-row company file with tags, 200 bad rows and several hundred duplicates: validate and dry run about 6 seconds together, import about 40 seconds, rollback about 75 seconds.
Rows are written 200 at a time in a transaction with a 60 second timeout. The limit is 50,000 rows per session (`MIGRATION_MAX_ROWS`) and 20 MB for a spreadsheet.

## Deals through the older import (FIG-800)

`POST /imports` now accepts `entity=DEAL` (permission `deals.create`): the same `ImportCsvForm` flow, run as a data run, with an error-report CSV and a `deals.imported` audit entry. It uses the
same row resolver as the migration, so a deal means the same thing in both.
