# Masking deal values and payments (FIG-1036, B2.07)

Deal values, margins, costs and payments are masked by role **everywhere**: lists,
detail, search, exports, notifications, timelines, comments and the dashboards.
The rule lives in one place, `src/auth/masking.ts`.

## The rules

- A deal's value is visible to people with `deals.view.value`, and to the deal's own owner.
- Margin needs `deals.margin`. Payments need `finance.view.payments` (Finance and Management).
- An aggregate (a pipeline total) is shown whole or not at all: if any deal it sums is hidden from the caller, the key is left out, not zeroed.
- A masked object says so (`value: null`, `valueMasked: true`); an aggregate that is hidden is absent.

## Where it is applied

| Surface | How |
|---|---|
| Deal lists, detail, board columns | `maskDeal`; `getBoard` omits `values` |
| Audit and timeline snapshots | `maskAuditSnapshot` |
| Proposals | `maskAmount` |
| Search | results carry names and stages only, never values |
| Notifications | `textForViewer` redacts money in the text for roles without the value permission, in the feed and in the email |
| Comments on a deal | amounts are redacted for a caller who may not see that deal's value |
| Dashboards and signals | values only where `canSeeAggregateValue`; counts are always allowed |
| Exports | deal export needs `deals.export`; the file is produced by the same list services, so it is masked the same way |

## Tests

- `tests/maskingAudit.test.ts` scans every surface for a sentinel value as each role (FIG-1036).
- `tests/stage2ExitGate.test.ts` repeats the scan for the Stage 2 surfaces (search, dashboard, signals, notification centre).

When you add a surface that can carry a deal value, add it to the scan.
