# Contributing

How work lands on `main` during the makeover (FIG-1011 / B0.03). `CLAUDE.md`
covers how Claude Code works in this repo; this page is for everyone.

## Branches

- `main` is protected. Nobody pushes to it directly, and force-pushes and
  branch deletion are blocked.
- Every change is made on a branch named `makeover/<code>-<slug>`, where
  `<code>` is the issue code from the plan and `<slug>` is a few lowercase
  words:
  - `makeover/b1-04-sessions`
  - `makeover/b0-03-pre-makeover`
  - `makeover/f2-04-home-dashboards`
- Work that is not part of the makeover plan uses `fix/<slug>` or
  `chore/<slug>` and still goes through a pull request.
- One Linear issue per branch and per pull request.

## Pull requests

1. Branch from an up-to-date `main`.
2. Commit with a message that starts with the issue key, for example
   `FIG-1011: document the branch rules`.
3. Open a pull request into `main`. Describe what changed, how it was
   verified, and anything the reviewer must check.
4. CI must be green: lint, typecheck, migrations, the full Vitest suite with
   its coverage floor, the Playwright e2e tests, and the Docker image build.
5. One reviewer approves.
6. **Squash merge** only, so `main` has one commit per issue. Delete the
   branch afterwards.

Tests are part of the work. Never skip, delete or loosen a failing test to
get green; fix the cause or raise it. New UI needs component tests, because
`src/app` coverage is low and the 35 % floor is held up by the services
(see `docs/TEST_BASELINE.md`).

## What must stay true

- Login, sign-up, forgot password, reset password and accept-invite pages do
  not change. New auth steps are new routes.
- Every tenant table has row-level security and a cross-organisation test.
  `tests/databaseSmoke.test.ts` fails if one does not.
- No secrets, tokens or real customer data in code, tests, logs or commits.

## Running the checks locally

```bash
npm run test:local     # starts Postgres, then the full suite
npm run typecheck
npm run lint
npm run e2e            # Playwright; npm run e2e:install first
```

## The `pre-makeover` tag

The tag `pre-makeover` marks the product exactly as it was before the
makeover began, on a commit with green CI. Do not move or delete it.

## Repository settings (for the repo admin)

The "Protect default branch" ruleset on GitHub should enforce all of this:

| Setting | Target | State on 22 Oct 2026 |
|---|---|---|
| Pull request required | yes | on |
| Direct pushes, force-pushes, deletion of `main` | blocked | on |
| Required approving reviews | 1 | **0** |
| Allowed merge methods | squash only | **merge, squash and rebase all allowed** |
| Required status checks | `Lint, typecheck, migrate, test, e2e` and `Docker image builds and runs` | **none** |
| Delete branch on merge | on | **off** |

Until the three bold rows are changed, the rules above are followed by
convention, not enforced. Changing them needs repository admin.
