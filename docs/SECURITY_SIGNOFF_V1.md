# Security sign-off: V1 (P1.06, FIG-1128)

Re-run of the G1.05 checklist (`docs/SECURITY_REVIEW_V1.md`) on the build at the head of `makeover/p1-staging-postgres`, 4 Nov 2026. It is an internal review with tests. **It is not an independent penetration test and does not replace one.** Nothing here is signed; the sign-off table at the end is empty on purpose.

Companion document: `docs/DATA_PROTECTION_CHECKLIST.md` (Kenya Data Protection Act, an engineering checklist).

## Status in one paragraph

No open Critical or High finding was found in the code. Six items are open and need a person: the production antivirus host (`CLAMD_HOST`), the independent penetration test, the report-only CSP (D-06), the dependency advisories (moderate only), the hosting review once the AWS design exists, and the two signatures. The acceptance criterion ("written sign-off with no open high or critical findings") can be met once Michael and Given sign and accept or close the items in the findings table.

**Contradiction to resolve (not resolved here).** The issue says this check depends on Q1.08 (FIG-1122), and Linear shows Q1.08 as Done, but `docs/V1_QUALITY_GATE.md` states that the gate is **not passed** (UAT, manual accessibility and device passes, design approval, FIG-444 metrics and the Michael and Given approval are not done). Given decides which is right.

## 1. Checklist re-run

| # | Check | Result on this build | Evidence |
|---|---|---|---|
| 1 | Tenant isolation (RLS on every tenant table, A sees nothing of B, attack walk of every route) | Pass | `tests/tenantAttack.test.ts` passed, 4 Nov 2026 |
| 2 | Mass assignment (a client cannot set role, organisation, owner or status fields it does not own) | Pass | `tests/massAssignment.test.ts` passed |
| 3 | Authorisation per role and masking | Pass (suite walks every route and role) | `docs/PERMISSION_MATRIX_REPORT.md`; not re-run in full here (the route walks take about 25 minutes) |
| 4 | Authentication: login, sign-up and invite rate limits, reset and invite tokens, session cookie flags | Pass | `tests/authRateLimiting.test.ts`, `tests/publicRateLimits.test.ts` passed; cookie is `httpOnly`, `SameSite=Lax`, `Secure` in production (G1.05) |
| 5 | Uploads: signed link bound to key, method and expiry; size limit; content must match declared type; checksum; antivirus verdict; infected file quarantined; scan error fails closed (file stays unavailable, 503) | Pass in code and tests; **production scan not active** (see finding S-01) | `tests/storage.test.ts`, `tests/files.test.ts` passed; `src/services/fileService.ts` (fail-closed branch) |
| 6 | Signed links and files check the organisation | Pass | a link edited to another organisation's key fails its signature (`tests/storage.test.ts`); file access needs access to the parent record (G1.05 finding 1) |
| 7 | CSV and formula injection in every export | Pass | `tests/csvInjection.test.ts` passed |
| 8 | Secrets compared in constant time; secrets redacted from logs | Pass | `tests/secretHandling.test.ts` passed |
| 9 | Rate limits (login, sign-up, forgot and reset, accept-invite, reset-confirm, website form, inbound email) | Pass. 30 attempts per 15 minutes per address on accept-invite and reset-confirm; **put in the release notes** (Linear comment, item 4) | `tests/publicRateLimits.test.ts` |
| 10 | Response headers | Pass with one open Minor (D-06, S-03) | `tests/securityHeaders.test.ts` passed; `config/securityHeaders.js` |
| 11 | SQL injection, stored XSS | Pass by design: Prisma everywhere, one raw query built from a fixed map with bound parameters; no `dangerouslySetInnerHTML`, `eval` or child processes in `src` | G1.05 review, unchanged |
| 12 | Privacy: erasure, access export, retention, legal hold | Pass | `tests/privacy.test.ts` passed |
| 13 | Dependencies in production | **Changed since G1.05**: `npm audit --omit=dev` reports 11 moderate, 0 high, 0 critical (G1.05 said 0). See S-04 | `npm audit --omit=dev`, 4 Nov 2026 |
| 14 | Secrets in the repository | Pass | see section 2 |
| 15 | Dev-only things stay dev-only (dev chips, Dev Super Admin, seeds refuse production) | Pass by the existing guards (`npm run check:build-output`, production boot check); not re-run here | `CLAUDE.md` rule 10 |

Test run on 4 Nov 2026: 10 files, 129 tests passed (`tenantAttack`, `massAssignment`, `files`, `storage`, `securityHeaders`, `publicRateLimits`, `authRateLimiting`, `secretHandling`, `csvInjection`, `privacy`), on a scratch Postgres database created for the run and dropped afterwards. One new file, `tests/securitySignoffSecrets.test.ts` (2 tests), passed; it ran against the standard test database because the global setup reads the configured one.

## 2. Secrets scan (counts and file names only)

| Scan | Patterns | Result |
|---|---|---|
| Current tree, tracked files | AWS access key ids, private key blocks, live payment keys, chat and source-host tokens, Linear API keys, three-part JWTs | 1 file: `tests/storage.test.ts`. The match is Amazon's published documentation example key, used to test signed URLs. Not a real credential. Allow-listed by value in the new test |
| Git history, all branches | same patterns | 1 file: `tests/storage.test.ts` (same example key). No other file |
| Assignment-style (`password`, `secret`, `token`, `api key` set to a 12+ character literal) | tracked files except the lockfile | Hits in 21 files: `.env.example`, `e2e/helpers.ts`, `playwright.config.ts`, `scripts/preview-local.js`, `src/api/contract/examples.json`, `src/auth/devAccounts.ts` and 15 test files. All are placeholders, dev-account or test fixtures by name; not reviewed value by value, and values are not printed here. `src/auth/devAccounts.ts` holds dev account material by design and is guarded for production (rule 10) |
| Tracked environment files | | `.env.example` and `.env.staging.example` only. No `.env` in the tree or in history |

The scan is repeatable: `tests/securitySignoffSecrets.test.ts` fails if a high-confidence secret appears in a tracked file or if any environment file other than the two examples is tracked. It does not scan history; rerun the history command before go-live (`git log --all -p -G"<pattern>" --name-only`). A dedicated scanner (for example gitleaks) in CI would be better; that is a CI change for Given.

## 3. Findings

Severity is the reviewer's judgement for an internal CRM holding customer contact and deal data. "Accept" needs Michael and Given in writing.

| ID | Severity | Area | Finding | State | Action and owner |
|---|---|---|---|---|---|
| S-01 | **Medium** (High if real customer files are accepted without it) | Uploads | Uploads are really scanned only when `CLAMD_HOST` is set; otherwise only the built-in test-file detector runs. `CLAMD_HOST` is in the staging template (`.env.staging.example`, FIG-1257) but **no ClamAV host exists or is confirmed**; it is commented out in `.env.example`. The code fails closed on a scan error, so a configured but down scanner blocks uploads rather than letting them through | Open | Stand up ClamAV for staging and production, set `CLAMD_HOST`, then upload the EICAR test file on staging and confirm it quarantines. Production now refuses to start without `CLAMD_HOST` (`src/storage/antivirusGuard.ts`, built 4 Nov 2026, `docs/DECISIONS.md` 6.5); the ClamAV host itself is still to be provided. Owner: Given (infrastructure) |
| S-02 | **Medium** (process) | Whole system | No independent penetration test has been done. This document and G1.05 are internal | Open | Schedule an external test of auth, tenant isolation and uploads before real customer data. Owner: Michael and Given |
| S-03 (D-06) | Low to Medium | Headers | The script-source Content-Security-Policy is report-only, has no `report-to` or `report-uri`, and still allows `'unsafe-inline'` scripts, so even when enforced it would not stop injected inline script until per-request nonces exist. The enforced policy covers framing, plug-ins, `<base>` and form targets only. No XSS sink was found in `src`, which is why this is not higher | Open (tracked as D-06 in `docs/QA_DEFECTS.md`, owner M12 P1.02) | Add a report endpoint, collect reports on staging, move to nonces, then enforce. Accept for V1 go-live only if Michael agrees |
| S-04 | Low (moderate advisories, no high or critical) | Dependencies | `npm audit --omit=dev`: 11 moderate in production (`@sentry/bundler-plugins`, `@sentry/nextjs`, `@sentry/node`, `archiver`, `archiver-utils`, `exceljs`, `glob`, `minimatch`, `readdir-glob`, `rimraf`, `zip-stream`), all from one `minimatch` advisory in transitive build or archive helpers. Full audit: 22 moderate, 0 high, 0 critical. G1.05 reported 0 in production; the advisory was published later (D-07) | Open | Accept for V1 and recheck before go-live; npm's suggested fix is a breaking Sentry upgrade. Owner: Given |
| S-05 | Low | Hosting | Hosting, network, backup and database access configuration is outside this repository. Production database is plain PostgreSQL, local now and AWS later (Michael, 4 Nov 2026), and no region or architecture is chosen | Open | Review once the AWS design exists (FIG-1258 data-location assessment feeds this): private network, encryption at rest and in transit, backups, least-privilege `figbloom_app` role, no public database port |
| S-06 | Low (release note) | Frozen auth routes | Accept-invite and reset-confirm now rate limit (30 per 15 minutes per address) behind two frozen pages | Open (documentation) | Add to the release notes (Linear comment) |
| S-07 | Info | Process | Linear shows Q1.08 Done while `docs/V1_QUALITY_GATE.md` says the gate is not passed | Open | Given decides |
| S-08 | Info | Secrets in CI | No automated secrets scanner runs in CI; the new test covers the working tree only | Open | Optional: add gitleaks or similar to CI (Given) |

Fixed in this pass: none. No defect that was small and clear enough to fix without a decision was found. Added: `tests/securitySignoffSecrets.test.ts`.

No open Critical or High findings.

## 4. Penetration-style pass (what was and was not done)

Done with the existing automated tests (attacker walks, not a human tester): tenant isolation as organisation A with organisation B's ids on every route; mass assignment; sign-in and public endpoint rate limits; upload signature tampering, size, content-type and checksum; quarantine; CSV injection; secret handling; security headers.

Not done: manual testing of session handling in a real browser, a fuzzing run, testing against staging (it does not exist yet, FIG-1123), tests of a real ClamAV, and any review of the host. These belong to the independent penetration test (S-02).

## 5. How to repeat

```
npm audit --omit=dev
npx vitest run tests/tenantAttack.test.ts tests/massAssignment.test.ts tests/files.test.ts tests/storage.test.ts tests/securityHeaders.test.ts tests/publicRateLimits.test.ts tests/authRateLimiting.test.ts tests/secretHandling.test.ts tests/csvInjection.test.ts tests/privacy.test.ts tests/securitySignoffSecrets.test.ts
```

On staging, once it exists: upload the EICAR string as a `.txt` file through the app and confirm the file is quarantined and cannot be downloaded; read the response headers of `/login`.

## 6. Sign-off

Acceptance: no open High or Critical finding, and every Open item above fixed or accepted in writing.

| Role | Name | Decision (approve, approve with accepted items, reject) | Accepted finding IDs | Date | Signature |
|---|---|---|---|---|---|
| Team Lead | Michael | | | | |
| Product owner | Given | **Approve with accepted items** | S-01 to S-08 accepted as open: S-01 and S-02 are the ones that matter (a production ClamAV host is set before real files, and an independent penetration test is still to be arranged) | 5 Nov 2026 | Recorded by Claude on Given's written instruction in the session of 5 Nov 2026; no handwritten signature |

**Michael's line is open.** Michael's approval of this sign-off is not recorded (Given reports that Michael approved the pilot waiver of FIG-1130 on 5 Nov 2026; that is a different decision). The findings table says accepting a finding needs Michael and Given in writing. Until Michael's line is filled, the Medium and lower items above are accepted by the product owner alone. No open High or Critical finding exists, which is what the acceptance criterion of FIG-1128 asks.
