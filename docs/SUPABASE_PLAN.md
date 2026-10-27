# Supabase and this project: recommendation and plan

27 Oct 2026. Written for Given (decision owner). Linear: FIG-1255 to FIG-1258 (P1.11 to P1.14, milestone M11); FIG-1259 is the separate Vitest upgrade.

## The short answer

**Use Supabase as the managed database and file storage. Do not use it as the backend.**

Keep what we have: the Next.js API (the frozen contract), Prisma, our own sign-in and sessions, and row-level security keyed on the organisation. Put the Postgres database (and, if the spike agrees, file storage) on Supabase. That gives the project what Supabase is genuinely best at for a team our size, a hosted Postgres with backups, point-in-time recovery, a dashboard and a pooler, without rewriting a backend that is built, frozen, and verified by 1,679 tests.

If we had no backend yet, building on Supabase's own Auth and Data API would be a reasonable choice. We have a backend, and for four specific reasons below it would be wrong to swap it now.

## What Supabase is made of, and where each piece fits

| Supabase piece | What we have today | Verdict |
|---|---|---|
| Postgres database | Postgres in Docker (local, CI); production host not chosen yet (`docs/DEPLOYMENT.md` is deliberately platform-agnostic) | **Adopt** (managed host). It is plain Postgres, so leaving later costs nothing. |
| Storage (S3-compatible) | Our own storage layer with a local driver and an S3 driver (`S3_ENDPOINT`, force-path-style) | **Adopt if the spike passes**; probably configuration only. |
| Connection pooler | Prisma connects directly | **Adopt** with the settings in the spike (pooled URL for the app, direct URL for migrations). |
| Auth | Our own: passwords, sessions with policy lifetimes, sign-in events, the frozen auth pages, new steps as new routes | **Do not adopt** (reasons 2 and 3). |
| Data API (PostgREST) | Our route handlers, which apply permissions and masking | **Do not adopt, and switch off** (reason 1). |
| Realtime, Edge Functions | Not needed in V1; jobs use our job framework (project rule) | **Not now.** Realtime can be evaluated for V2 live updates. |

## Why not Supabase as the backend

1. **Masking lives in our services, not in the database.** Deal values, margins, costs and payments are masked by role in lists, detail, search, exports, notifications and timelines (hard rule 7); payments only for Finance and Management. That logic is in code. Supabase's Data API lets a browser read tables directly, so every table it exposed would be a way around that masking. The only safe configuration is the Data API off, which removes most of what Supabase-as-backend means.
2. **The authentication pages are frozen.** Login, sign-up, forgot, reset and accept-invite must not change in markup, style or behaviour (hard rule 1). Supabase Auth has its own flows, tokens and emails. Adopting it would change that behaviour, or mean building a bridge that keeps our sessions anyway.
3. **Our tenant model is not Supabase's.** Our row-level security policies read the organisation the server sets for each transaction (`app.current_organization_id`). Supabase's usual pattern reads the signed-in user from a token. Both are valid; mixing them is a rewrite of all 63 tenant tables' policies and of the 8-test tenant attack suite that proves them.
4. **The contract is frozen and the date is fixed.** V1 is 284 documented paths at version 1.0.0, with a typed client, a mock server and a hash gate, and goes live on 8 Nov. Replacing the backend means replacing all of that. Nothing in V1 needs a capability our backend lacks.

## What was checked (and where it comes from)

- **Prisma and the pooler.** Supabase's guide has the app use the transaction-mode pooler (port 6543, `pgbouncer=true`) and migrations use a direct connection (port 5432) through `directUrl`. Our per-transaction organisation setting is transaction-scoped, so it should hold in transaction mode, but that is the first thing the spike must prove. ([Supabase: Prisma](https://supabase.com/docs/guides/database/prisma.md), [Prisma: PgBouncer](https://www.prisma.io/docs/guides/performance-and-optimization/connection-management/configure-pg-bouncer))
- **Roles.** There is no superuser on Supabase; the `postgres` role has extra privileges instead, and a role you create inherits what `PUBLIC` can do. Our deploy step creates the application's database role and grants it table rights (`npm run db:bootstrap-role`, `db:grant-role`). Whether those two commands work unchanged is unconfirmed and is the second thing the spike must prove. ([Supabase: roles and superuser](https://supabase.com/docs/guides/database/postgres/roles-superuser))
- **Extensions.** Our search uses `pg_trgm` indexes. Supabase keeps extensions in their own schema, so whether our index definitions resolve is a spike item (not confirmed in the docs I could reach).
- **Backups.** Pro includes daily backups kept 7 days; point-in-time recovery is a paid add-on (listed at $100 a month per 7 days of retention, and it needs at least a small compute size). Check the current price on the dashboard before deciding. ([Supabase: backups](https://supabase.com/docs/guides/platform/backups.md), [pricing](https://supabase.com/pricing.md))
- **Region.** I could not find an Africa region on Supabase's list, and a 2021 staff answer said Cape Town was not offered for new projects. The nearest are Europe or India. This matters for latency from Nairobi and for the Kenya Data Protection Act's rules on sending personal data abroad (P1.06 already covers the DPA check). ([Supabase: regions](https://supabase.com/docs/guides/platform/regions.md))

## Risks to settle in the spike, in order of importance

1. **Data API and default grants.** A new Supabase project exposes the `public` schema through the Data API and grants rights to its `anon` and `authenticated` roles. Our tables live in `public`. The spike must switch the Data API off and revoke those grants, and a test must prove an `anon` connection reads nothing.
2. **Role bootstrap and grants** work on Supabase's `postgres` role (above).
3. **Pooler plus Prisma plus our transaction setting** (above), including the interactive transactions our organisation context uses.
4. **`pg_trgm` and the search indexes** (above).
5. **Data location and transfer** under the Kenya DPA, and latency from Nairobi, measured with our performance suite (`docs/PERF_BASELINE.md`) against the chosen region. The performance baseline was taken on a local database, so any hosted database will be slower per query; the targets must be re-checked there.
6. **Cost** of PITR and compute against the alternatives.

## Plan, with the Linear issues

| Issue | What | Due | Outcome |
|---|---|---|---|
| **P1.11** (FIG-1255) Decision record and technical spike | A Supabase project in the best-available region; run migrations, the role and grant steps, the whole test suite, the tenant attack suite and the performance suite against it; Data API off; measure latency and cost | 30 Oct | **Go / no-go**, written, with the numbers |
| **P1.12** (FIG-1256) Staging on Supabase | Becomes the database part of P1.01: environment variables, pooled and direct URLs, deploy pipeline, the migration rehearsal run against it | 3 Nov | Staging running on it |
| **P1.13** (FIG-1257) File storage on Supabase Storage | Private bucket through our S3 driver, signed links, the organisation checks and the file tests, malware scan hook (`CLAMD_HOST`) | 4 Nov | Files on Supabase, or a written reason not to |
| **P1.14** (FIG-1258) Backups, restore drill and cutover on Supabase | Restore drill and recovery targets (extends P1.03), production cutover and rollback plan (extends P1.05), DPA transfer assessment and processor agreement (feeds P1.06) | 6 Nov | Ready for go-live |

The spike runs in parallel with the frontend milestones and touches no application code unless it has to (a `directUrl` setting in the schema, and a pooled connection string). **If the spike is red** (for example the role bootstrap cannot work, or latency from the available region misses the targets), nothing is lost: the plan falls back to a managed Postgres elsewhere or a self-run one, and P1.01 proceeds as written.

## Decisions for Given

1. Approve the hybrid (Supabase as database and storage, not as backend). **My recommendation: yes.**
2. Accept that Supabase has no Africa region (to be confirmed in the spike) and that P1.06's DPA check decides whether that is acceptable for production data.
3. Accept the PITR cost if the spike goes green.

Revisit Supabase's Auth, Data API or Realtime only for V1.1 or V2, and only for features that do not touch masked data.
