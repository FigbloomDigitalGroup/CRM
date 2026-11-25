# Create invoice (UC-R8, FIG-1779)

A person with `invoices.create` (Management and Finance) can create an invoice from the Invoices page ("New invoice", and the quick create entry, which opens the page with `?new=1`), or from a **won deal** ("Create invoice" on the deal). The dialog is `src/ui/screens/invoices/NewInvoiceDialog.tsx`. One amount for now; line items are UC-B1.

## Rules that did not change
- A deal must be won (`DEAL_NOT_WON`). The company must not be archived. `dueOn` is still required by the API; the screen only suggests it from the issue date plus the payment terms.
- The create route takes an `Idempotency-Key` (B0.06). The dialog keeps one key for its whole life, so a double click or a retry never makes a second invoice.
- The API checks `finance.manage.payments` and `invoices.create`. Sales, Delivery and Restricted Technical cannot create. Payments stay invisible to anyone without `finance.view.payments` (rule 7); nothing here shows a payment.

## Terms (additive migration `20261129090000_invoice_terms`)
Two nullable columns on `invoices`: `payment_terms_days` (0 to 365) and `terms` (text, up to 2000 characters). Existing rows are untouched. The invoice view returns `paymentTermsDays` and `terms`.

## Numbering
Setting `invoices.settings` (organisation setting row): `{ auto: boolean, prefix: string }`, off by default, prefix default `INV-` (1 to 20 characters: letters, digits, `- _ . /`). It is read and written through `GET/PATCH /quote-settings` as `invoiceNumbering` (additive; no new route, so the frozen contract is untouched), by Management (`configuration.manage`), in Settings under "Invoice numbering".

- `number` may be left out of the create. With auto on, the next number is the prefix plus one more than the highest all-digit number that has the prefix (case-insensitive), padded to four digits (`INV-0001`). Numbers of another shape are ignored, never rewritten. With auto off, a missing number is refused with `NUMBER_REQUIRED`.
- A typed number is always used as typed, even with auto on.
- The number is chosen and the row inserted in one transaction, behind `pg_advisory_xact_lock(hashtext('invoice-number:<org>'))`, the same method quotes use (`quote-number:<org>`). The unique index on `(organization_id, lower(number))` stays the backstop; a lost race on a typed number answers `DUPLICATE_INVOICE_NUMBER`.

## Tests
`tests/invoiceNumbering.test.ts` (pure), `tests/createInvoice.test.ts` (database: roles, concurrency, case-insensitive uniqueness, DEAL_NOT_WON, idempotency, terms, setting), `tests/components/screens/invoices/newInvoice.test.tsx`, `tests/components/settingsplus/invoiceNumbering.test.tsx`.
