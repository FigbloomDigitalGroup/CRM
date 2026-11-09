# How data flows through Figbloom CRM

One page to answer "where does this come from?". Every file named here exists in the repository. Paths are from the project root.

## The short version

```
Browser (React screen)
   │  useApiQuery("getTasksGroups", …)             src/ui/data/hooks.ts
   ▼
Typed API client  ── HTTP GET /api/orgs/figbloom/tasks/groups?…   src/api-client/, src/ui/data/client.ts
   │  (session cookie travels with the request)
   ▼
Route handler     src/app/api/orgs/[orgSlug]/tasks/groups/route.ts
   │  1. resolveRequestContext(orgSlug)  → who you are, your role, your permissions   src/auth/requestContext.ts
   │  2. validate the query with Zod
   ▼
Service           src/services/taskService.ts   (rules: what you may see, paging, grouping)
   │  masking: src/auth/masking.ts (deal values, margins, payments hidden by role)
   ▼
Repository        src/repositories/…            (the queries)
   ▼
withOrgContext    src/db/orgScopedClient.ts     sets app.current_organization_id for this request
   ▼
PostgreSQL 16     row-level security: organization_id = current_setting('app.current_organization_id')
   │
   ▼  rows come back up the same chain, masked, as JSON
React Query cache → the screen renders it
```

## Where each kind of data lives

| What | Where |
|---|---|
| Business records (organisations, users, memberships, roles, leads, deals, companies, contacts, tasks, activities, invoices, payments, notifications, audit events, …) | PostgreSQL, 72 tables, defined in `prisma/schema.prisma` |
| Sessions | A secure cookie in the browser plus a session row in the database (`sessions`) |
| Uploaded files | A storage driver (`src/storage/`): local disk under `.data/files` in development, an object store later. The database keeps the file record, not the bytes |
| Background work (imports, notifications, automations) | Job tables in the database, run by `npm run jobs:worker` (`src/jobs/`) |
| Per-device display settings (theme, density, text size) | The browser's localStorage, key `figbloom-device-prefs` |
| Account-level preferences | Database, through `src/preferences/` and the preferences API |
| Demo screens (Mail, Chat, Video, Customer Support workspace, Super Admin console) | Fixed demo data in `demo/` folders in the browser. They never touch the database. Search the code for `demo/` |

## The database

- **PostgreSQL 16**, in Docker (`docker compose up -d --wait`), container `figbloom_crm_postgres`, reachable at `localhost:25432`.
- **ORM:** Prisma 5 (`prisma/schema.prisma`, migrations in `prisma/migrations/`).
- **Three databases on the one server:** `figbloom_crm_dev` (what you work in), `figbloom_crm_test` (rebuilt by the test run), `figbloom_crm_perf` (50,000 leads, for the performance run).
- **Two database roles:**
  - `figbloom` (admin): runs migrations and seeds, and is used by `src/db/adminClient.ts` for work that has no organisation (sign-in, platform identity, dev chips).
  - `figbloom_app` (least privilege): the app's normal connection. It is subject to row-level security.
- **Tenant isolation:** every tenant table has a row-level-security policy, for example on `tasks`: `organization_id = current_setting('app.current_organization_id')`. `withOrgContext` sets that value inside a transaction for each request, so a query can only ever see its own organisation's rows, even if the application code forgot a filter.

## Who you are, and what you may see

1. **Sign-in:** `/login` posts to `/api/auth/login`. The server checks the password, creates a session and sets the cookie.
2. **Every request:** `resolveRequestContext(orgSlug)` reads the cookie and loads your membership, role and permission keys for that organisation. That object (the `ctx`) is passed to every service.
3. **Permissions:** keys such as `deals.view.all`, `deals.view.value` and `finance.view.payments` come from the role seed (`prisma/seedData.ts`). Routes and services check them. A role without access gets an explained "no access", not a blank page.
4. **Masking:** `src/auth/masking.ts` removes deal values, margins and payment amounts for roles that may not see them. It runs in the service layer, so it applies to lists, detail, search, exports, notifications and the assistant alike. Payments are visible only to Finance and Management.
5. **The screen also checks:** `useMember()` gives the screen the same permission keys, so it hides buttons the API would refuse. The API is the real boundary; the screen only avoids showing what would fail.

## The contract between frontend and backend

- Request and response shapes are defined once as Zod schemas in `src/api/dto/` and the operation lists in `src/api/*Operations.ts`.
- The OpenAPI document is generated from them (`npm run openapi:export`). The V1 contract is frozen in `src/api/contract/openapi.v1.json`; changing it needs `npm run contract:update` and a changelog note.
- The typed client in `src/api-client/` is generated from the same contract, which is why screens call named operations such as `getTasksGroups` and not hand-written URLs.
- Errors use one envelope (`error`, `code`, `message`, `fieldErrors`, `requestId`), and creates carry idempotency keys so a double click cannot create two records.

## How pages are rendered

- **Server:** `src/app/o/[orgSlug]/layout.tsx` runs on the server, resolves your context, builds the navigation for your role, and renders the app frame (sidebar, top bar). Pages inside it start from `loading.tsx`, which shows the loader while they stream in.
- **Client:** each screen in `src/ui/screens/<area>/` is a client component. It loads its own data with React Query from the API, caches it, refetches on an interval for live views, and invalidates the cache after a write.
- **Writes:** `useApiMutation` sends POST/PATCH calls and then invalidates the affected queries so lists refresh.
- **Phone:** the same API with a separate layout under `/o/{org}/m`, plus an offline queue (`src/ui/screens/mobile/queue.ts`) that sends changes to `/sync/batch` when the connection returns.

## A concrete example: phone Tasks

1. `src/ui/screens/mobile/Lists.tsx` calls `useApiQuery("getTasksGroups", { query: { pageSize: "8", groups: "OVERDUE,TODAY,…" } })`.
2. The browser requests `/api/orgs/figbloom/tasks/groups?pageSize=8&groups=…` with your cookie.
3. `src/app/api/orgs/[orgSlug]/tasks/groups/route.ts` resolves your context, validates the query, and calls `listTasksGrouped(ctx, …)`.
4. `src/services/taskService.ts` limits the filters to your own tasks if your role only has `tasks.view.own`, works out the due-date groups in your time zone, and runs the counts and the page of rows together.
5. The queries run inside `withOrgContext`; Postgres returns only your organisation's rows.
6. The JSON returns, React Query stores it, and the screen draws the groups.

## What is real and what is demo

- **Real, on the API and database:** everything in V1 (leads, deals, tasks, calendar, companies, contacts, conversations, handoffs, renewals, payments, reports, preferences, settings, the phone layout).
- **On demo data, not yet wired:** the V1.1 and V2 screens built for the presentation. They are listed in `docs/RESTRUCTURE_LOG.md`. Wiring them to the real API is milestones M13 and M14, and a screen is not Done until it is wired and tested against the API.

## See it live

- Browse the tables: `npx prisma studio`.
- Query directly: `docker exec -it figbloom_crm_postgres psql -U figbloom -d figbloom_crm_dev`, then `\dt`, `\d leads`, `select * from deals limit 5;`.
- See the row-level-security policy: `select policyname, qual from pg_policies where tablename = 'tasks';`.
- See masking: open the browser's Network tab on the Deals page as Sales, then as Delivery, and compare the `value` field in the `/deals` response.
- See isolation: the dev database has a second organisation (`figbloom-sandbox`); sign-in lands on `figbloom` and its data never appears in the other.

## Questions you may be asked

- **Where is the data stored?** In PostgreSQL 16 in Docker (`figbloom_crm_dev` locally). Files go to a storage driver and the database keeps the record.
- **Can one customer see another's data?** No. Row-level security in the database limits every query to one organisation, on top of the application checks.
- **Can Delivery see deal values?** No. Masking runs in the service layer, so it applies on every screen, export and search, and the API itself withholds the value.
- **Do the screens read the database directly?** No. They call the API, which checks who you are first.
- **Is everything real data?** V1 is. Mail, Chat, Video, the Customer Support workspace and the Super Admin console are demo data until the V1.1 and V2 backend work (M13 to M16).
- **What happens offline on a phone?** Changes queue on the device and send through `/sync/batch` when the connection returns.
