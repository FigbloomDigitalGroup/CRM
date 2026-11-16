# Branch and worktree cleanup (P2-01, FIG-1584)

Written 2026-11-16. Inventory first: **nothing in the tables below has been deleted except where the "Done" section says so.** Deleting a branch needs Given's written confirmation of the exact list (CLAUDE.md rule 4). A squash merge is detected from the GitHub pull requests (the branch's last commit equals the merged PR's head), because `git branch --merged` cannot see it.

Counts: 68 refs: KEEP 6, DELETE 57, ASK 5.

Recovery: the last commit of every branch is in the table. A deleted branch can be recreated with `git branch <name> <hash>` for as long as git keeps the commit (reflog about 90 days; remote branches also stay in the merged pull request on GitHub).

## Decision (Given, 16 Nov 2026)

**No branch is deleted.** Every branch below is kept for future reference, and `dev-mike` (Michael's branch) must never be deleted. The DELETE verdicts in the table are therefore only a record of which branches are fully merged; they are not an instruction. The only cleanup done is the worktree and the Docker containers in the "Done" section. If branches are ever pruned, this table is the starting point (it has the last commit hash of each).

## Done on 16 Nov 2026

- Worktree `figbloom-crm-m14` removed (clean, no unpushed work, its one commit already in dev-given by content). `git worktree list` now shows `figbloom-crm` (dev-given) and `figbloom-crm-m13` (this branch).
- Docker: 14 containers removed (the local staging stack: 9, the observability stack: 4, and one exited bucket-setup job). Volumes and images were left. Kept: `figbloom_crm_postgres` (used by the main worktree, port 25432), `figbloom_crm_postgres_m13` (used here, port 55432), and the object store and ClamAV pair (likely needed by P2-04). Other projects' containers were not touched.
- Stashes and tags untouched.

## Worktrees

| Worktree | Branch | Verdict |
|---|---|---|
| figbloom-crm | dev-given | KEEP |
| figbloom-crm-m13 | makeover/m19-p2-21-27 | KEEP (the one in use) |
| figbloom-crm-m14 | makeover/mvp-golive-status | **Removed 16 Nov 2026** (Given: not used). It was clean, had no unpushed work, and its one commit `6fe1112` (docs status line) is already in dev-given by content. The branch itself is kept until the list below is confirmed. |

## Stashes (not branches; listed so nothing is lost by accident)

- `stash@{0}`: on makeover/p1-staging-postgres, "local CLAUDE.md deadline edit (set aside for M15)"
- `stash@{1}`: on main, "m0-working-tree-backup"

Both are untouched. Ask Given before dropping them.

## Tags

Kept: api-v1.0, api-v1.1, backend-v1, backend-v1.1, backend-v2, pre-makeover.

## How the ASK branches were checked

For each, the files its unique commits changed were compared with dev-given. `g203-waiver` and `handover-smoke-results` match exactly, so nothing is lost by deleting them. The other local branches whose pull request was merged still differ in some files, but dev-given has changed those files since, so a difference does not prove lost work. `makeover/b6-03-platform-identity` (remote only, FIG-1135) has a commit that is not in dev-given and has no merged pull request, and `backup/pre-sync-main` is a pre-makeover backup of the old main (5 commits). Those two stay unless Given says otherwise.

## Branches

| Kind | Branch | Last commit | Date | Status | Verdict |
|---|---|---|---|---|---|
| local | `dev-given` | `34937de22` | 2026-11-11 | protected | **KEEP** |
| remote | `dev-given` | `e9fe58812` | 2026-11-16 | protected | **KEEP** |
| remote | `dev-staging` | `93fa4292c` | 2026-10-22 | protected | **KEEP** |
| local | `main` | `67946ca7b` | 2026-10-23 | protected | **KEEP** |
| remote | `main` | `67946ca7b` | 2026-10-23 | protected | **KEEP** |
| local | `makeover/m19-p2-21-27` | `b195aca2f` | 2026-11-16 | protected (branch in use) | **KEEP** |
| remote | `dev-mike` | `93fa4292c` | 2026-10-22 | merged (in dev-given history) | **DELETE** |
| remote | `fig-750-customer-lifecycle-states-settings` | `0d8a04dc6` | 2026-10-14 | merged (in dev-given history) | **DELETE** |
| remote | `fig-751-website-lead-assignment-rules` | `3cfea8c93` | 2026-10-14 | merged (in dev-given history) | **DELETE** |
| remote | `fig-752-page-usage-tracking` | `5bd793cbe` | 2026-10-14 | merged (in dev-given history) | **DELETE** |
| remote | `fix/ci-node-22-v2` | `16d8547e0` | 2026-10-12 | merged (in dev-given history) | **DELETE** |
| local | `makeover/b0-02-test-baseline` | `39a3d5345` | 2026-10-22 | PR #10 merged into main, tip identical | **DELETE** |
| remote | `makeover/b0-02-test-baseline` | `39a3d5345` | 2026-10-22 | PR #10 merged into main, tip identical | **DELETE** |
| local | `makeover/b0-03-pre-makeover` | `283d3004c` | 2026-10-22 | PR #11 merged into main, tip identical | **DELETE** |
| remote | `makeover/b0-03-pre-makeover` | `283d3004c` | 2026-10-22 | PR #11 merged into main, tip identical | **DELETE** |
| local | `makeover/b0-04-design-spec` | `2b0a2be38` | 2026-10-22 | PR #13 merged into main, tip identical | **DELETE** |
| remote | `makeover/b0-04-design-spec` | `2b0a2be38` | 2026-10-22 | PR #13 merged into main, tip identical | **DELETE** |
| local | `makeover/b0-05-decisions` | `2871153d8` | 2026-10-22 | PR #14 merged into main, tip identical | **DELETE** |
| remote | `makeover/b0-05-decisions` | `2871153d8` | 2026-10-22 | PR #14 merged into main, tip identical | **DELETE** |
| local | `makeover/b0-06-07-api-backend` | `778a8539d` | 2026-10-22 | PR #16 merged into main, tip identical | **DELETE** |
| remote | `makeover/b0-06-07-api-backend` | `778a8539d` | 2026-10-22 | PR #16 merged into main, tip identical | **DELETE** |
| local | `makeover/b0-08-09-dev-seed-super-admin` | `e60add3e5` | 2026-10-22 | PR #17 merged into main, tip identical | **DELETE** |
| remote | `makeover/b0-08-09-dev-seed-super-admin` | `e60add3e5` | 2026-10-22 | PR #17 merged into main, tip identical | **DELETE** |
| local | `makeover/fig-801-802-e2e-csrf` | `5854f8618` | 2026-10-22 | PR #15 merged into main, tip identical | **DELETE** |
| remote | `makeover/fig-801-802-e2e-csrf` | `5854f8618` | 2026-10-22 | PR #15 merged into main, tip identical | **DELETE** |
| local | `makeover/fix-pl14-e2e-race` | `f7079b3a8` | 2026-11-11 | PR #55 merged into dev-given, tip identical | **DELETE** |
| local | `makeover/m0-claude-md` | `b9f64e0f1` | 2026-10-22 | PR #12 merged into main, tip identical | **DELETE** |
| remote | `makeover/m0-claude-md` | `b9f64e0f1` | 2026-10-22 | PR #12 merged into main, tip identical | **DELETE** |
| local | `makeover/m1-identity-preferences-org-profile` | `ca03a276e` | 2026-10-23 | merged (in dev-given history) | **DELETE** |
| local | `makeover/m10-frontend-v11-v2-demo` | `636b7b928` | 2026-10-29 | merged (in dev-given history) | **DELETE** |
| remote | `makeover/m10-frontend-v11-v2-demo` | `636b7b928` | 2026-10-29 | merged (in dev-given history) | **DELETE** |
| local | `makeover/m11-demo-names` | `9ff8988fb` | 2026-11-04 | merged (in dev-given history) | **DELETE** |
| local | `makeover/m11-qa-and-fixes` | `f0c094139` | 2026-11-01 | merged (in dev-given history) | **DELETE** |
| local | `makeover/m13-decision12-on-dev-given` | `3fc0e04b3` | 2026-11-06 | merged (in dev-given history) | **DELETE** |
| local | `makeover/m14-signoffs` | `7e341fefd` | 2026-11-10 | merged (in dev-given history) | **DELETE** |
| local | `makeover/m14-smtp-health` | `c9b6c99b5` | 2026-11-09 | merged (in dev-given history) | **DELETE** |
| local | `makeover/m14-test-report` | `e5c9543c2` | 2026-11-09 | merged (in dev-given history) | **DELETE** |
| local | `makeover/m14-vercel-mvp` | `f850086a9` | 2026-11-09 | merged (in dev-given history) | **DELETE** |
| local | `makeover/m15-g203-contract` | `d33e43950` | 2026-11-10 | merged (in dev-given history) | **DELETE** |
| local | `makeover/m16-close` | `1fcc68582` | 2026-11-12 | PR #60 merged into dev-given, tip identical | **DELETE** |
| local | `makeover/m16-perf` | `6a43494da` | 2026-11-12 | PR #62 merged into dev-given, tip identical | **DELETE** |
| local | `makeover/m16-v11-qa` | `4653e9d95` | 2026-11-09 | PR #39 merged into dev-given, tip identical | **DELETE** |
| local | `makeover/m17-closeout` | `3cabea760` | 2026-11-11 | PR #58 merged into dev-given, tip identical | **DELETE** |
| local | `makeover/m17-signoff` | `9d3441685` | 2026-11-12 | PR #59 merged into dev-given, tip identical | **DELETE** |
| local | `makeover/m17-tag-note` | `365bee484` | 2026-11-12 | PR #61 merged into dev-given, tip identical | **DELETE** |
| local | `makeover/m19-urgent-p2-02-11-15-17` | `500e72d29` | 2026-11-13 | PR #63 merged into dev-given, tip identical | **DELETE** |
| local | `makeover/m3-customers-delivery-finance` | `4703c5794` | 2026-10-27 | PR #21 merged into dev-given, tip identical | **DELETE** |
| local | `makeover/m6-frontend-foundation` | `570eec99e` | 2026-10-27 | merged (in dev-given history) | **DELETE** |
| local | `makeover/m7-sales-workspace` | `e6443a57a` | 2026-10-28 | merged (in dev-given history) | **DELETE** |
| local | `makeover/m8-customers-finance-reports` | `56e45ed3e` | 2026-10-28 | merged (in dev-given history) | **DELETE** |
| local | `makeover/m9-settings-preferences-mobile` | `999b01732` | 2026-10-28 | merged (in dev-given history) | **DELETE** |
| local | `makeover/mvp-golive-status` | `6fe111293` | 2026-11-11 | PR #57 merged into dev-given, tip identical | **DELETE** |
| local | `makeover/p1-staging-postgres` | `b14d3419b` | 2026-11-05 | PR #30 merged into dev-given, tip identical | **DELETE** |
| local | `makeover/perf-navigation-and-queries` | `3fc0e04b3` | 2026-11-06 | merged (in dev-given history) | **DELETE** |
| local | `makeover/sky-contrast-and-baselines` | `3c7ffbb64` | 2026-11-10 | merged (in dev-given history) | **DELETE** |
| local | `makeover/sky-default-theme` | `220eea33a` | 2026-11-10 | merged (in dev-given history) | **DELETE** |
| local | `makeover/sky-first-theme` | `3c77739ce` | 2026-11-11 | merged (in dev-given history) | **DELETE** |
| local | `makeover/sync-local-sprint5` | `ec3195e23` | 2026-10-21 | PR #9 merged into main, tip identical | **DELETE** |
| remote | `makeover/sync-local-sprint5` | `ec3195e23` | 2026-10-21 | PR #9 merged into main, tip identical | **DELETE** |
| remote | `security/remove-malware` | `8dd58a74c` | 2026-10-09 | merged (in dev-given history) | **DELETE** |
| local | `worktree-agent-a405881c84d25efee` | `67946ca7b` | 2026-10-23 | merged (in dev-given history) | **DELETE** |
| local | `backup/pre-sync-main` | `38229b190` | 2026-10-19 | NOT merged: 5 commit(s) not in dev-given, no merged PR ("Sprint 5 almost complete- before makover") | **ASK** |
| remote | `makeover/b6-03-platform-identity` | `0f69cdf3f` | 2026-11-04 | NOT merged: 1 commit(s) not in dev-given, no merged PR ("FIG-1135 (B6.03): platform identity foundation") | **ASK** |
| local | `makeover/g203-waiver` | `6e6d033d7` | 2026-11-11 | PR #56 merged; its one extra local commit changes 1 file, now identical in dev-given (content verified) | **DELETE** |
| local | `makeover/handover-smoke-results` | `15702dea9` | 2026-11-11 | PR #54 merged; its one extra local commit changes 1 file, now identical in dev-given (content verified) | **DELETE** |
| local | `makeover/later-versions-backlog` | `67cb02ca7` | 2026-11-11 | PR #52 merged; extra local commit changes docs/LATER_VERSIONS.md, which dev-given has edited since (probably safe) | **ASK** |
| local | `makeover/m13-backend-v11` | `a8ca14133` | 2026-11-05 | PR #29 merged; 6 extra local commits, 559 files, 134 differ now because dev-given moved on (probably safe, check the 6 commits) | **ASK** |
| local | `makeover/m15-v11-gates` | `b6d62fb24` | 2026-11-09 | PR #34 merged; 16 files in the extra commit, 10 differ now because dev-given moved on (probably safe) | **ASK** |
