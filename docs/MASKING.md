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
| Recurring services (Stage 3) | `maskServiceValue`: the value follows the deal rule (Management, Finance, and the service's owner) |
| Payments (Stage 3) | Invoices, payment records and the deal follow-up note need `finance.view.payments` on every route; they are not indexed by search, not in any list, export, timeline or dashboard for other roles, and the deal owner's overdue notice carries no number or amount (`docs/PAYMENTS.md`). Their audit snapshots are `PAYMENT_ENTITIES` in `src/auth/masking.ts`. |
| Customer 360 (Stage 3) | Deals through `maskDeal`; payments are a `no_access` section for any role without `finance.view.payments`; the timeline leaves out messages linked to records the caller cannot open |
| Conversations hub (Stage 3) | A row is listed only when the caller may open every record it links to (`linkedRecordsVisibleWhere`) |
| Audit log (Stage 4) | `payment` entities (`PAYMENT_ENTITIES`) are left out of the organisation-wide log, its filters and its CSV for a reader without `finance.view.payments` (asking for one by name is refused); money in deal and service snapshots is blanked without `deals.view.value`; automation runs on invoices are hidden the same way |
| Push (Stage 4) | The text of a push notification is redacted for the recipient's role like the notification centre; a device is only ever sent its own person's notifications |
| Reports v2 (Stage 3) | Money columns become `null` and the chart falls back to counts without `deals.view.value` |

## Tests

- `tests/maskingAudit.test.ts` scans every surface for a sentinel value as each role (FIG-1036).
- `tests/stage2ExitGate.test.ts` repeats the scan for the Stage 2 surfaces (search, dashboard, signals, notification centre).
- `tests/stage3ExitGate.test.ts` scans eleven surfaces and every dashboard section for a sentinel invoice number and amount as each role other than Finance and Management.

When you add a surface that can carry a deal value, add it to the scan.
