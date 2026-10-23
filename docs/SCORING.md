# Lead score and customer health (FIG-1032, B2.03)

Scores are rules, not guesses. Every point has a reason a salesperson can read
("Referral +12", "No contact for 8 days -6"), the same inputs always give the
same score, and a score only informs: nothing in the system moves a deal,
assigns a lead or sets a discount because of it.

The rules are in `src/lib/scoring.ts` (pure functions, unit tested). The values
below are code constants. Each organisation can scale a whole factor group with
a weight from 0 (off) to 3 (triple); the default is 1 for every group. Weights
live in the organisation settings (`scoring.lead_weights`,
`scoring.health_weights`), are edited through `PATCH /api/orgs/{org}/scoring/weights`
by Management, and apply from the next recompute.

## When scores are computed

- When something relevant happens: a lead is created or edited, its
  qualification answers change, an activity or communication is logged against it
  or against its company, a task is created for a company, a deal's outcome changes.
- Every night for every open lead and every active company, as the background job
  `scores.recompute` (one job per organisation, job framework B2.18).

A score is stored on the record (`leads.score_value`, `companies.health_value`)
with its factors, so lists can show and sort by it.

## Lead score (0 to 100)

Every lead starts with **+20** ("A lead to work"), so a score always has at least
one visible factor. Bands: **High** 70 and over, **Medium** 40 to 69, **Low** under 40.

| Group (weight key) | Factor | Points |
|---|---|---|
| temperature | Hot / Warm / Cold | +30 / +15 / 0 |
| source | Referral, Existing customer | +12 |
| source | Physical meeting | +8 |
| source | Website | +6 |
| source | Networking, Phone, WhatsApp | +5 |
| source | Direct outreach, Email, LinkedIn | +4 |
| source | Facebook, Instagram, Advertising | +2 |
| source | TikTok | +1 |
| responseSpeed | First contact within an hour / a day / three days / slower | +12 / +8 / +3 / -5 |
| contact | No contact yet and the lead is over 3 days old | -8 |
| contact | Quiet since the last touch: over 14 days / over 6 days | -10 / -6 |
| contact | Contacted in the last 6 days | +6 |
| qualification | All applicable answers in / at least half / some / none | +15 / +8 / +2 / -3 |
| similarWins | Deals won before for the same service: 5 or more / 2 to 4 / 1 | +10 / +6 / +3 |
| followUp | The next follow-up date has passed | -5 |

"Similar past wins" counts won deals only. It never reads or shows a deal value,
so it is the same for every role.

## Customer health (0 to 100)

Every customer starts at **50** ("Customer account"). Bands: **Good** 70 and over,
**Watch** 40 to 69, **At risk** under 40.

| Group | Factor | Points |
|---|---|---|
| activity | 3 or more contacts / 1 or 2 contacts in the last 30 days | +15 / +8 |
| activity | None in 30 days, and the account is over 60 days old | -12 |
| tasks | Each overdue open task on the company (capped) | -4, at most -12 |
| renewals | An active service past its end date | -10 |
| renewals | An active service ending within 60 days | -6 |
| deals | A deal won in the last 12 months | +8 |
| deals | An open deal | +5 |
| payments | Overdue payments (capped) | -5 each, at most -15 |

The **payments** factor is visible only to Finance and Management
(`finance.view.payments`). For anyone else it is removed from the factor list and
the total and band are recomputed without it, so the numbers shown always add up
and the hidden factor is not a hint. The payments tracker itself arrives in B3.03;
until then no payment factor is produced. Support tickets will join the same way
when they exist.

## Reading a score

- `GET /api/orgs/{org}/leads/{id}/score` and `GET /api/orgs/{org}/companies/{id}/health`
  return `{ score, band, factors: [{ key, label, points }], computedAt }` as the
  caller may see it. A record's score is computed on the spot the first time it is asked for.
- The lead list and detail carry the same `score` object.
- The caller must be able to open the record; the score never widens access.
