# Security review: backend V1 (G1.05, FIG-1072)

Scope: the API, its data access and its dependencies as they stand at the end of M5, reviewed by walking every route (see the permission matrix, `docs/PERMISSION_MATRIX_REPORT.md`, and the tenant attack test), reading the places user input reaches a sink, and checking the dependency tree. It is an internal review with tests, not an independent penetration test. Nothing here replaces one before real customers are on the system.

## Summary

| Area | Result |
|---|---|
| Dependencies in production (`npm audit --omit=dev`) | 0 known vulnerabilities |
| Dependencies in development | 7 advisories, all in the Vitest 2 test toolchain (accepted, see below) |
| Tenant isolation | Verified three ways (RLS on every tenant table, A-sees-nothing-of-B for every table, an attack walk of every route as A with B's ids). One defect found and fixed. |
| Authorisation | Every route walked as every role against a recorded matrix; one gap found and fixed. |
| Server errors reachable from input | Four found by the walks and fixed (three in the role walk, one in the tenant walk). |
| Secrets in logs, code, tests | Redaction added to the logger; constant-time comparison for shared secrets; a test scans for them. |
| Public endpoints | The three that take a token now rate limit like login and sign-up. |
| CSV exports | Formula injection neutralised in every export. |
| Response headers | Added (enforced and report-only policy). |

## Findings and what was done

Severity is my own judgement for an internal CRM holding customer contact and deal data.

### Fixed

1. **A file attached to a record could be opened by anyone holding the attachments permission, by file id (authorisation gap, High).** `GET /files/{id}` checked the caller's attachments permission but not that they could open the lead, deal, contact, company or task the file hangs off, so a user who could not see a deal could still download its attachment given the file id (an unguessable UUID, which limits exploitation, but a leaked id or a shared link would be enough). Now the caller must be able to open the record the file is attached to, and a file not yet attached belongs to its uploader alone (`src/services/fileService.ts`, `assertAttachmentRecordAccess`). Found by the role walk.
2. **Server errors reachable from a request (Medium each, no data exposed).** Each answered 500 where a 4xx belongs; fixed so the caller gets a clear error:
   - recording a communication against an activity id that does not exist or belongs to another organisation (foreign key violation);
   - website-key settings when no key exists yet (missing row);
   - adding a proposal number a deal already has (a unique-constraint violation);
   - **creating a lead with a status, source, company, contact or service id from another organisation** (foreign key violation; found by the tenant attack walk). The data was never at risk, because the keys are per organisation and refuse it, but the answer was a 500 and now is a validation error naming the field.
3. **CSV / formula injection (Medium).** A lead can type `=HYPERLINK(...)` into the public website form, and Management then opens an export in a spreadsheet that runs it. Every CSV the app writes (lead, contact, company, deal exports, audit and data runs, payments, privacy exports, reports) now goes through one writer that prefixes such a cell with an apostrophe, leaves numbers, phone numbers and amounts alone, and a test fails if any other file starts writing CSV (`src/lib/csv.ts`, `tests/csvInjection.test.ts`).
4. **Public endpoints without a rate limit (Medium).** Accepting an invite, confirming a password reset and the inbound-email webhook were unlimited; they now use the same database-backed limiter as login (30 attempts per 15 minutes per address for the first two; generous per-address and per-organisation ceilings for the webhook, so a mail provider never reaches them). Needs a migration (`20261028090000_rate_limit_actions`). **Note for Given:** the accept-invite and reset-confirm limits are on the API routes behind two of the frozen auth pages; the pages themselves are untouched, but a person who trips the limit now gets the standard 429 error from those routes.
5. **Shared secrets compared with `===` (Low).** The cron secret (two routes) and the website and inbound keys are now compared in constant time (`src/auth/secretCompare.ts`), and a wrong or missing secret always answers 401 (`tests/secretHandling.test.ts`).
6. **Secrets could reach logs (Low).** The logger now redacts passwords, tokens, API keys, authorisation and cookie headers, and the cron and website key headers, wherever they appear in a logged object.
7. **No security headers (Low to Medium).** Every page and API answer now carries `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, a strict referrer policy, a permissions policy that switches camera, microphone, location and payment off, `Cross-Origin-Opener-Policy`, an **enforced** Content-Security-Policy (no framing, no plug-ins, forms post only to the app, `<base>` cannot be repointed) and, in production only, HSTS. A stricter script policy is sent as **Report-Only** (`config/securityHeaders.js`, `tests/securityHeaders.test.ts`).
8. **Reference-data upgrade could overwrite an organisation's edits (found by the migration rehearsal).** See `docs/MIGRATION_REHEARSAL.md`, finding 2: the defaults seeding rewrote names and order, so it now has a fill-only mode for the upgrade.

### Reviewed and found sound

- **SQL injection.** All data access goes through Prisma. There is exactly one raw query built as a string (`src/repositories/customFields.ts`), and it takes its table and column names from a fixed map and binds the organisation and key as parameters.
- **Passwords.** bcrypt with 12 rounds; sessions are opaque tokens in an `httpOnly`, `SameSite=Lax` cookie that is `Secure` in production.
- **Stored cross-site scripting.** The app renders no raw HTML (no `dangerouslySetInnerHTML`, `eval`, `new Function` or child processes anywhere in `src`); the enforced CSP forbids framing and plug-ins on top.
- **Uploads.** Files are created through a signed upload link with a per-purpose size limit and content-type declaration; signed links are bound to one key, one method and an expiry, and a link edited to point at another organisation's key fails its signature (tested).
- **Masking.** Deal values, margins, costs and payments are masked by role everywhere the matrix walks (lists, detail, search, exports, notifications, timelines); the walk scans every response for the sentinel values that must never appear for a role.

### Accepted, with reasons

**Dev-tooling advisories (7, all from `vitest@2.1.9` and what it pulls in: vite, esbuild, tinypool, vite-node, @vitest/mocker, @vitest/coverage-v8).** The advisories are about the Vitest UI server, Vite's development server, and prototype-pollution through worker options. None of that is shipped: the production image installs without dev dependencies (`npm audit --omit=dev` reports 0), and none of it is reachable in CI or on a laptop unless someone starts Vitest's browser UI or Vite's dev server on an exposed port, which we do not. The fix is a major upgrade (Vitest 5), which changes the test runner under all 1,000+ tests at the moment the backend is being frozen. I have **not** done it. Recommendation: do it as its own change right after the V1 gate, with the whole suite as the safety net. Given and Michael to confirm.

### Not done, and not claimed

- A script-source CSP that is **enforced** (needs per-request nonces on every page, a frontend change; it is reporting today, so it blocks nothing and shows what it would).
- An independent penetration test, and a review of the hosting, network and backup configuration (outside this repository).
- A production antivirus. The scan hook exists and quarantines an infected upload, but it only talks to ClamAV when `CLAMD_HOST` is set; without it only the built-in test-file detector runs. **Production must set `CLAMD_HOST`** (add to the go-live checklist).

## How to check it yourself

- `npm test -- tenantAttack securityHeaders csvInjection publicRateLimits secretHandling` runs the security tests.
- Response headers: start the app, open `http://localhost:3000/login` with the browser's developer tools, Network tab, and read the response headers of the first request.
- Export safety: in a dev organisation, create a lead whose company name is `=1+1`, export leads to CSV and open it in a spreadsheet: the cell shows `=1+1` as text, not `2`.
- Rate limit: send 31 bad invite tokens to `POST /api/auth/accept-invite` from one address; the 31st answers 429 `RATE_LIMITED`.

## Supply-chain and secrets checklist (the Sprint 4 incident list, and rotation)

Checked on 27 Oct 2026:

- **No `.vscode/tasks.json`** or any `.vscode` folder is tracked.
- **No font files** are tracked in the repository (no fake-font payloads).
- **No whitespace-padded code lines** (a line with 60 or more consecutive spaces or tabs before code) anywhere in `src`, `scripts`, `tests`, `config`, `prisma`, `public`, `next.config.js` or `package.json`.
- **Install scripts:** the lockfile has only five packages that run one at install time: `@prisma/client`, `@prisma/engines`, `prisma`, `esbuild` (twice, one nested under vite) and `fsevents`. All are the expected, well-known ones; `package.json` itself has no `preinstall`, `postinstall` or `prepare` script. Re-check this list on every dependency change.
- **Secrets rotation:** the app role's database password rotates by running `npm run db:bootstrap-role` again (`docs/DEPLOYMENT.md`); website and inbound-email keys rotate in settings with a 24-hour grace window (up to 72). The cron secret and the storage signing secret are environment variables: change them in the host's secret store and restart; links signed with the old storage secret stop working at once (they expire within minutes anyway). Never commit them; the log redaction and `tests/secretHandling.test.ts` cover accidental logging.
- **Findings tracked:** the three decisions above (Vitest upgrade, `CLAMD_HOST`, the frozen-page rate-limit note) are the only open items; there are no open Urgent or High findings from this review.
- **Sign-off:** the acceptance criterion asks for Michael's signature on this document; that is his to give.
