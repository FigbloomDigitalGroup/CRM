# Quote and invoice permissions (UC-R1, FIG-1775)

Ten new permission keys split the coarse quote and payment keys so the Quotes and Invoices pages can be gated precisely. **No role's
access changes.** The new keys are not enforced anywhere yet (UC-R2 onward does that); this issue adds them, seeds them and proves
that every role keeps what it has.

## The keys

| Key | Area | Release | Meaning |
|---|---|---|---|
| `quotes.view` | Quotes | V1.1 | See the quotes list and open a quote |
| `quotes.edit` | Quotes | V1.1 | Edit a quote that has not been sent |
| `quotes.send` | Quotes | V1.1 | Send a quote by email or share link |
| `invoices.view` | Finance | V1 | See the invoices list and open an invoice |
| `invoices.create` | Finance | V1 | Create an invoice |
| `invoices.edit` | Finance | V1 | Edit or void an invoice |
| `invoices.send` | Finance | V1 | Send an invoice |
| `payments.record` | Finance | V1 | Record or reverse a payment (record only; nothing is processed) |
| `finance.reports.view` | Finance | V1 | See the finance reports |
| `finance.export` | Finance | V1 | Export invoices and payments. More than 500 rows still needs `export.bulk` |

The existing keys stay: `quotes.create`, `quotes.approve`, `finance.view.payments`, `finance.manage.payments`.

## The compatibility rule (how no role changes)

`PERMISSION_IMPLICATIONS` in `prisma/seedData.ts` is data. `effectivePermissionKeys` (`src/auth/permissions.ts`) adds the implied keys
for **every** role, platform or custom, before it applies the release filter:

| A role that holds | also carries |
|---|---|
| `quotes.create` | `quotes.view`, `quotes.edit`, `quotes.send` |
| `quotes.approve` | `quotes.view` (see below) |
| `finance.manage.payments` | `invoices.create`, `invoices.edit`, `invoices.send`, `payments.record`, `finance.export` |
| `finance.view.payments` | `invoices.view`, `finance.reports.view` |

One level only: an implied key implies nothing. `quotes.approve` implying `quotes.view` goes one step beyond the issue text: today the
quote read routes accept `quotes.create` **or** `quotes.approve` (`READ_KEYS` in `quoteService.ts`), so an approver who cannot build
quotes must keep reading them when `quotes.view` is enforced.

**Finance also gets `quotes.view`**, as the issue says (Finance cannot read quotes today). It is the only addition that is not implied,
and it does nothing until UC-R2 enforces `quotes.view`.

### Effective keys before and after, per platform role

"Before" is the baseline commit `9bbc385`; "after" is this branch. Every other key is identical (proved by the snapshot test).

| Role | Gains at V1 | Gains at V1.1 and V2 |
|---|---|---|
| Management | `invoices.view/create/edit/send`, `payments.record`, `finance.reports.view`, `finance.export` | the same, plus `quotes.view/edit/send` |
| Sales | nothing | `quotes.view`, `quotes.edit`, `quotes.send` |
| Delivery | nothing | nothing |
| Finance | `invoices.view/create/edit/send`, `payments.record`, `finance.reports.view`, `finance.export` | the same, plus `quotes.view` |
| Restricted Technical | nothing | nothing |

Custom roles gain only what their stored keys imply: a custom role with `quotes.create` gains `quotes.view`, `quotes.edit`, `quotes.send`
at V1.1 and later; one with `quotes.approve` gains `quotes.view`; a custom role with none of the source keys gains nothing. The payment
keys can never be on a custom role (rule 7), so nothing implied by them reaches one.

## How existing organisations get the keys

The role and permission catalogue is **global**. Migration `20261128110000_quote_invoice_permission_keys` adds the ten catalogue rows and
links them to the five platform roles, mirroring `ROLE_PERMISSIONS` (the precedent is `20261127130000_import_export_all_roles`). It is
additive and idempotent (`ON CONFLICT DO NOTHING`), removes and renames nothing, and does not touch any custom role or any
organisation's data. A later `npm run seed` (the reconciling sync) then finds nothing to change and writes no audit event; the tests prove
that the migration and `seedData.ts` agree.

`seedOrganizationDefaults` is not run on any existing organisation, and does not need to be: the keys are catalogue data, not
per-organisation data.

## Reserved keys (UC-D3, DECISIONS 11.9.3)

`departments.manage` is reserved (Management only, refused on a custom role). The key itself arrives with departments (UC-C1); it is
listed now so it is refused from its first day. `finance.export` and `integrations.manage` stay delegable.

**One addition that needs Given's confirmation:** `payments.record` is also on the sensitive list (`SENSITIVE_RESERVED_KEYS` in
`src/lib/roleLimits.ts`) with the other payment keys. Reason: CLAUDE.md rule 7 (payments visible only to Finance and Management), and a
custom role created from Management would otherwise copy it. UC-D3 named only `departments.manage`; lifting this is one line.

New change keys also need a view key on a custom role: `quotes.edit` / `quotes.send` need `quotes.view`, `quotes.create` or
`quotes.approve`; `invoices.create` / `invoices.edit` / `invoices.send` need `invoices.view`.

## Where the new keys will be enforced (not done in this issue)

| Surface today (checks the old key) | Will check | Issue |
|---|---|---|
| `quoteService.ts` read routes (`READ_KEYS`), quote list and drawer | `quotes.view` | UC-R2, UC-R3 |
| `quoteService.ts` create and edit (`requirePermission "quotes.create"`) | `quotes.create` (new quote), `quotes.edit` (edit a draft) | UC-R4 |
| `quoteService.ts` / `quoteDocumentService.ts` / `quoteSignatureService.ts` share and send | `quotes.send` | UC-R4 |
| `navigation.ts`, `commandIndex.ts` (Payments entry), quick create | `quotes.view`, `invoices.view`, the create keys | UC-R2 |
| `paymentService.ts` invoice list and summary (`finance.view.payments`) | `invoices.view`; balances and payments **still** need `finance.view.payments` | UC-R7 |
| `paymentService.ts` create invoice (`finance.manage.payments`) | `invoices.create` | UC-R8 |
| `paymentService.ts` record, reverse, void, send | `payments.record`, `invoices.edit`, `invoices.send` | UC-R9 |
| `reportsV2Service.ts` finance reports (`finance.view.payments`) | `finance.reports.view` | UC-R7 / R11 |
| `exportService.ts` invoice and payment export | `finance.export` (above 500 rows `export.bulk`) | UC-R7 |

Until those issues land, the old keys decide everything, exactly as before.

## Tests

`tests/quoteInvoicePermissions.test.ts` (61 tests). `tests/fixtures/effectiveKeysBaseline.json` holds the "before" state, generated from
the baseline commit's own `seedData.ts`, `permissions.ts` and `featureFlags.ts` for every platform role at V1, V1.1 and V2 with the
departure flags at their defaults, with the umbrella flag off and with every departure off, plus a sample custom role. The test fails on
a lost key, an extra key, or a new key a role should not gain. It also covers custom roles, the catalogue and the table, the reserved
and view-key rules, the migration and sync agreeing, a custom role surviving a sync, and one organisation not seeing another's custom
role. No table is added, so there is no new row-level-security policy to test.

## Enforced on the invoice routes (UC-R7, UC-R9)

`paymentService` now also requires the split keys, on top of `finance.view.payments` / `finance.manage.payments` (never instead of them):
list and read need `invoices.view`; send needs `invoices.send`; void and edit need `invoices.edit`; record and reverse a payment need
`payments.record`; the CSV export needs `finance.export`. Every role that held the old keys carries these by implication, so no role changes.
The Invoices page (`/o/{org}/invoices`, `src/ui/screens/invoices/`) shows balances, the ageing strip and payments only with `finance.view.payments`.
The list gained additive query params `amountMin`, `amountMax`, `hasBalance` (also on the export) and `totals.ageing` (buckets `current`,
`d1_30`, `d31_60`, `d61_90`, `d90_plus`, each `{ count, outstanding }`); the frozen contract 1.1.0 is not edited, the 1.2.0 bump lists them.
