# Sales draft-only invoices (UC-R10, FIG-1781)

Decision D-10 (`docs/DECISIONS.md` 11.9.2, architecture 13.7 C-5): invoices are not payments. If Management switches it on, the **Sales** role can create a **draft** invoice from a won deal it owns and see that draft's number, amount, due date and status. Finance sends and chases. **Off by default.**

## The setting
Organisation setting row `invoices.sales_draft` = `{ enabled: boolean }` (no migration). Read and written through `GET/PATCH /quote-settings` as `salesDraftInvoices` (additive; no new route, contract 1.1.0 untouched). The GET always returns the boolean. The PATCH needs `configuration.manage` (Management) and is audited (`invoice_sales_draft.updated`). Editor: Settings, "Invoice numbering" tab, second card "Sales draft invoices" (`src/ui/screens/settingsplus/SalesDraftInvoices.tsx`).

## What Sales can do when it is on
Only the platform role `SALES` without `finance.view.payments` / `finance.manage.payments` (custom roles never get it).
- **Create** (`POST /invoices`): the deal is required, must be won (as before) and must be **owned by the caller**. `sent: true` is refused (`SALES_DRAFT_ONLY`), a missing deal is refused (`SALES_DRAFT_NEEDS_DEAL`), someone else's deal is refused (403). Numbering and terms work as for Finance. The audit event is marked `salesDraft`.
- **List and read** (`GET /invoices`, `GET /invoices/{id}`): only invoices still in DRAFT on the caller's own deals. Anything else (sent, paid, void, another person's deal) is absent or answers not found; the status filter cannot widen the view. No totals, no ageing.
- The response is a whitelist (`SALES_DRAFT_FIELDS`, `src/lib/invoiceSalesDraft.ts`): id, number, status (`DRAFT`), deal, company, amount, currency, issue and due dates, notes, terms. Never paid amount, balance, overdue state, payments or the stored status. Rule 7 holds.
- Still refused: send, edit, void, record or reverse a payment, export (they need Finance or Management keys).

When the setting is off every Sales call behaves exactly as before (403).

## Screen
The deal's "Create invoice" button shows for a Sales person on their own won deal when the setting is on (read from `GET /quote-settings`, which needs the quotes feature; if that read fails the button stays hidden). Sales has no Invoices page, so after creating they stay on the deal.

## Decisions taken
- Drafts only: once Finance sends an invoice it leaves Sales' view (showing SENT would eventually reveal part-paid or paid state).
- Own deals only, by deal owner.

## Tests
`tests/invoiceSalesDraft.test.ts` (pure), `tests/salesDraftInvoices.test.ts` (database), `tests/components/settingsplus/salesDraftInvoices.test.tsx`.
