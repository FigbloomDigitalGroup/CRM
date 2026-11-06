# Post-launch review and V1.1 re-plan (FIG-1132, P1.10)

Goal: use real adoption and feedback to confirm or reshape V1.1. Result (Linear): a comment on FIG-1132 with the decisions and the updated plan. Comment only; status stays with Given (CLAUDE.md rule 13). Nothing here authorises a merge, tag or scope cut: the agreed cut order (E1, E2, F1, S5, S7, then decision-gated V2 items, then V2 polish) changes only with Given's say-so, and V1 is never cut.

Related: [PILOT_PLAN.md](PILOT_PLAN.md) (the measures and the report script), [GO_LIVE.md](GO_LIVE.md) (hypercare, Sev definitions), [RESTRUCTURE_LOG.md](RESTRUCTURE_LOG.md) (what is on demo data), [DECISIONS.md](DECISIONS.md), [FEATURE_FLAGS.md](FEATURE_FLAGS.md).

## 0. Timing problems to settle first

1. **Hypercare vs the review date.** The issue is due 22 Nov. Two weeks of hypercare from a 10 Nov go-live ends about 24 Nov ([GO_LIVE.md](GO_LIVE.md) asks Given to decide). Plan: hold the review on **Thu 19 Nov** with what exists (9 days of production data), or after hypercare closes, whichever Given picks. The data will be at most about 9 to 12 days.
2. **Three-week adoption (A7) cannot be shown by 22 Nov.** Record the weeks seen so far; the review can confirm "on track", not "proven".
3. **Milestone numbers in the issue are stale.** The issue says "M12 to M15"; since 29 Oct 2026 go-live is M12, V1.1 backend is M13 and its gate M14, V1.1 QA and release M15, V2 backend and release M16 and M17 (CLAUDE.md, RESTRUCTURE_LOG). V1.1 and V2 **frontend** is already built on demo data (M10). So the re-plan is about the order of wiring and testing against the real API, not about what to design.
4. **Overlap.** The review meets V1.1 backend work already under way (M13, 14 Nov, M14, 15 Nov), before the review date. A re-plan on 19 Nov can reorder M15 to M17 only; anything earlier is already decided. Say this in the meeting or hold a short early checkpoint on 13 Nov using pilot data.

## 1. Review agenda (90 minutes)

Attendees: Given, Michael, Engineering, support owner. Inputs: production adoption report (weekly), the pilot report, hypercare notes (FIG-1131 comments), [QA_DEFECTS.md](QA_DEFECTS.md), feedback log (section 3).

1. (5) Where we are: dates, what is live, hypercare state, Sev counts.
2. (15) Adoption and success metrics against FIG-444 (section 2).
3. (15) Defects and feedback triage results (section 3): top issues by role, what hurts most.
4. (10) Reliability: error rate, latency, jobs, backups, incidents since go-live ([OBSERVABILITY.md](OBSERVABILITY.md)).
5. (30) V1.1 and V2 scope, order and sprint plan (section 4), including the three open decisions.
6. (10) Date check: 22 Nov holds; buffer days 21 and 22 Nov; anything at risk and the cut order.
7. (5) Decisions read back and recorded (section 5); who posts the FIG-1132 comment.

## 2. Adoption and success metrics against FIG-444 (actuals left blank)

Pull the numbers weekly with `scripts/adoption-report.ts` ([PILOT_PLAN.md](PILOT_PLAN.md) section 6): counts only, no values or payments. Windows are the trailing 14 days (A1, A5), 7 days (A6). Enter week 1, 2 and 3 in the columns as they become available.

| Measure | FIG-444 threshold | Pilot actual | Week 1 | Week 2 | Week 3 | Met / not met / waived | Note |
|---|---|---|---|---|---|---|---|
| A1 Active users | at least 80% signed in and created or updated in 14 days | | | | | | |
| A2 Opportunities entered within 48 h | at least 90% (manual reconciliation) | | | | | | Manual, not in the app |
| A3 Leads captured | 100% website, at least 80% manual within 24 h | | | | | | First-contact time not stored |
| A4 Deals maintained | at least 80% of open opportunities above a value threshold | | | | | | Value check by Management in the app |
| A5 Task usage | at least 70% of Sales and Delivery users in 14 days | | | | | | |
| A6 Reports usage | every Management user weekly | | | | | | From `page_views`; no screen shows it |
| A7 Consistency | A1 to A5 hold 3 consecutive weeks | | | | | | Earliest possible about 1 Dec |
| D1 Duplicates | under 5% unresolved after 30 days | | | | | | No bulk scan exists |
| D2 Missing ownership | 0 | | | | | | |
| D3 Placeholder values | 0 (sample) | | | | | | Manual sample |
| D4 Stale leads / deals | under 10% / under 10% | | | | | | |
| D5 Companies with a contact | at least 90% | | | | | | |
| D6 Pipeline inconsistency | 0 | | | | | | |
| D7, D8 Orphans, wrong organisation | 0 | | | | | | By test |
| Reliability (FIG-444 section 15) | no unresolved critical defect | | | | | | |
| Support volume (FIG-444 section 15) | tracked | | | | | | From the triage log; not an app metric |
| Business value (qualitative) | better lead and pipeline visibility, less spreadsheet use | | | | | | Interview 3 users per role |

Extra, not in FIG-444 (optional): page views per page and distinct visitors per page (which screens are unused), sign-in failures and lockouts per week, mobile use. Usage of screens added after M9 is **not tracked**: `page_views` knows only 12 labels (see PILOT_PLAN section 5), so V1.1 screens such as Mail, Chat, Customer Support or the console need new labels before their adoption can be judged. Decide in section 4 whether that is V1.1 work.

## 3. Defect and feedback triage template

Collect from: hypercare daily notes, the support channel, user interviews, the pilot report, [QA_DEFECTS.md](QA_DEFECTS.md). One row per item. Only Given and Michael change a severity.

| Id | Source | Role | Screen or flow | Type (defect / change request / question / praise) | Sev (1 to 4) | Frequency (how many users) | Workaround | V1 fix / V1.1 / V2 / backlog / decline | Linear issue | Owner | Decision date |
|---|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | | |

Rules for the triage:

- A defect stays a defect (V1 fix) until a workaround is accepted by Given.
- A request that adds scope goes to the backlog first, never straight into a milestone (GO_LIVE: no scope changes during hypercare).
- Anything about masking, payments visibility or cross-organisation data is Sev-1 and is not discussed in the review; it is already an incident.
- Count requests by role, so one loud user does not set the plan.

Summary after triage: open Sev-1 __, Sev-2 __, Sev-3 __, Sev-4 __; top 5 themes: __; fixed in hypercare: __.

## 4. V1.1 scope re-plan checklist

Use the adoption table, the triage table and the RESTRUCTURE_LOG clean-up list. Tick each when decided, and write the result in the decision log.

- [ ] List every V1.1 and V2 screen still on demo data (search `demo/` and read [RESTRUCTURE_LOG.md](RESTRUCTURE_LOG.md)); for each, mark: wire as planned / wire later / drop / change.
- [ ] Re-rank V1.1 items by evidence: used by whom, asked for by whom, blocked by what. An item no pilot user asked for and no adoption number needs is a candidate to move later (never V1, never without Given).
- [ ] Check the order of M13 (V1.1 backend, 14 Nov), M14 (gate, 15 Nov), M15 (QA and release, 17 Nov), M16 (V2 backend, 19 Nov), M17 (V2 QA and release, 20 Nov) against the real effort left; confirm 21 and 22 Nov stay buffer.
- [ ] If the date is at risk, apply the agreed cut order only with Given's say-so: E1, E2, F1, S5, S7, then decision-gated V2 items, then V2 polish. Write down what was cut, who said so, and the date.
- [ ] Defect fixes from triage that belong in V1.1 (with the Linear issues) versus patches to V1.
- [ ] Instrumentation: which new page labels and metrics V1.1 needs so adoption of the new screens is measurable; whether to build the Management usage screen (D2) over `page_views`, which has no screen today.
- [ ] A mapping from "wire to the real API" to test evidence: a screen on demo data is not Done until it is wired and tested against the real API (CLAUDE.md).
- [ ] Feature flags per release train and organisation: which flags turn on for FigBloom when ([FEATURE_FLAGS.md](FEATURE_FLAGS.md)), and who flips them.
- [ ] Updated sprint plan posted on FIG-1132; milestones and due dates in Linear updated by Given (Engineering does not change statuses).
- [ ] Hypercare end date decision (24 Nov vs 22 Nov) recorded.

### Three open decisions

State of the record today (so the review does not decide twice): [DECISIONS.md](DECISIONS.md) already marks all three "Decided" in the 22 Oct sign-off, but the issue asks for them to be "recorded" with real adoption data. The review should **confirm or change** them, and the code state below shows what each costs.

| Decision | What was decided (22 Oct) | Where the build is | Questions for the review | Outcome (blank) |
|---|---|---|---|---|
| Support by email | There is no Customer Support role (decision 12, 5 Nov 2026). Members raise a request from Help, Contact support; it goes to Figbloom support through Resend (`docs/SUPPORT_BY_EMAIL.md`). | Needs the Resend key and the three support variables set in production. | Did members use Contact support, and did the answers reach them by email? |
| Organisation switcher | V1.1 (DECISIONS 2.3); V1 shows no switcher to single-organisation users. Flag `organisation.switcher` (V1.1, on). | Switcher UI is demo-only (`src/ui/screens/orgside/`, opt-in cookie); needs a user with more than one organisation membership. | Does anyone at FigBloom belong to more than one organisation today? If not, is it still V1.1 or should it move to V2 (candidate on the cut list: not listed there, so Given decides)? | |
| Deposit request on signed quotes | V2 and decision-gated; signed quotes stay status-only; "no payment processing" stands for V1 and V1.1 (DECISIONS 2.5). | The deposit button is always present in the quote builder on demo data and the client page shows it only for a quote that carries one ([M10_COMMERCIAL.md](M10_COMMERCIAL.md)): this looks at odds with "status-only until then". | Go or no-go on taking deposits at all? If go: M-Pesa provider, who reconciles, Finance sign-off, security review. If not decided, hide the button for the V1.1 release. | |

## 5. Decision log template

Add one row per decision at the review; copy into the FIG-1132 comment.

| # | Date | Decision | Options considered | Reason and evidence (adoption number, feedback id) | Decided by (Given / Michael) | Effect on scope, order or date | Linear issues to update | Review again on |
|---|---|---|---|---|---|---|---|---|
| 2 | | Organisation switcher | | | | | | |
| 3 | | Deposit request | | | | | | |
| 4 | | Hypercare end date | | | | | | |
| 5 | | V1.1 order and sprint plan | | | | | | |
| 6 | | Cuts, if any (cut order, Given's say-so) | | | | | | |
| 7 | | | | | | | | |

FIG-1132 closing comment (post, do not change the status):

```
Post-launch review held __ with __. Adoption: __ (weeks of data: __). Triage: __ open by severity.
Decisions: Support by email __; organisation switcher __; deposit request __.
V1.1 plan: M13 __, M14 __, M15 __; V2: M16 __, M17 __. Cuts: none / __ (by Given on __).
Not proven: A7 (three weeks) __, D1 __. Next check: __.
```

## 6. What only people can do

Run and attend the review; give the interview feedback; decide the three open decisions; approve any cut; set the hypercare end date; update Linear milestones and statuses (Given).
