# The `adminDb` rule (UC-F4, audit S-1)

**New code never reads or writes tenant data through `adminDb`. It uses `withOrgContext`.**

## Why

There are two database connections:

| Client | File | Connects as | Row-level security (RLS) |
|---|---|---|---|
| `withOrgContext` | `src/db/orgScopedClient.ts` | `figbloom_app`, the least-privilege role | **Enforced.** The query only sees the current organisation's rows. |
| `adminDb` | `src/db/adminClient.ts` | the schema owner | **Bypassed.** The database does not stop a query reaching another organisation. |

A query on tenant data through `adminDb` is safe only because its own `where` names the organisation. That is one forgotten filter away from a cross-tenant read or write, for example an `update` or `delete` by bare `id` after an earlier fetch that a later refactor drops. Through `withOrgContext` the database makes that mistake harmless.

## What is allowed on `adminDb`

Four jobs have a real reason to be on the owner connection:

1. **identity**: sign-in, sessions, two-step, membership and organisation lookups that run before an organisation is known (or that resolve it);
2. **bootstrap**: creating an organisation and its reference data, and its lifecycle;
3. **platform**: the platform console, which acts across organisations by design, and the health probe;
4. **cron claim**: background jobs and sweeps that must see every organisation to find and claim work.

Global tables that carry no `organizationId` (users, sessions, roles, permissions, platform tables) are not tenant data; using `adminDb` on them is not covered by this rule.

## How it is enforced

- **Allow-list:** `config/adminDbAllowList.json` lists every file and tenant model that uses `adminDb` today, with a category and a count. The ~500 `tenant-data` entries are grandfathered; UC-F5 migrates them to `withOrgContext`, one service at a time.
- **Test:** `tests/adminDbAllowList.test.ts` (a normal Vitest file, so it runs in CI) fails on a new tenant-data use, on a file that gains uses, and on a list that was not lowered after a migration. It reads the code with the TypeScript compiler, so it also sees uses inside `$transaction` callbacks and raw SQL; where `adminDb` is passed to another function it cannot follow, it counts the call as an UNKNOWN escape that must be reviewed.
- **Lint:** `.eslintrc.json` has a `no-restricted-imports` override: a file under `src/` may not import `db/adminClient` unless it is on the override's `excludedFiles` list (the same pattern the repository uses for its `fetch` exceptions). The test checks that the list is exactly the set of importing files, so a dynamic `import()` cannot slip past.

## If you think you need `adminDb`

You almost never do. Use `withOrgContext`. If the use really is identity, bootstrap, platform or a cron claim:

1. Put the call in a file whose whole purpose is that job (do not add a business-record query to an identity file).
2. Get a reviewer's agreement that it belongs to one of the four categories.
3. `npx tsx scripts/adminDb-allowlist.ts --write`, set the entry's `category` in `config/adminDbAllowList.json`, and add the file to the `.eslintrc.json` override. The diff of those two files is the decision, and it must be reviewed.

## When you migrate a site

Move the code to `withOrgContext`, then run `npx tsx scripts/adminDb-allowlist.ts --write`. The test insists on this so the list only ever shrinks. `docs/ADMINDB_CLASSIFICATION.md` is a dated snapshot of the whole picture (counts by category and area, the writes and reads with no organisation in their filter, and the places the scanner cannot follow); regenerate it with the same command.

## Related

- Audit finding S-1 (`docs/UNIVERSAL_CRM_EXISTING_STATE_AUDIT.md`) and architecture section 20 (`docs/UNIVERSAL_CRM_ARCHITECTURE.md`).
- The three isolation layers (composite foreign keys, RLS, repository scoping) are described in the README.
