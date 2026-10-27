# Payments tracker (FIG-1049, FIG-1050; B3.03, B3.04)

Finance records the status of invoices and the payments received against them. **Nothing is processed and no bank
detail is stored.** A signed quote may later raise an invoice record (V1.1, an open decision); today an invoice is
created by hand, or as the draft a renewal can raise.

## Who can see it

| Role | View | Change | Next note |
|---|---|---|---|
| Finance | `finance.view.payments` | `finance.manage.payments` | `finance.followup.note` |
| Management | `finance.view.payments` | `finance.manage.payments` | via `finance.manage.payments` |
| Sales, Delivery, Technical, Support | none | none | none |

Payments are invisible to every other role on every surface: the list, Customer 360, search (invoices are not
indexed), exports, notifications, timelines and dashboards. `tests/stage3ExitGate.test.ts` scans all of them for a
sentinel invoice number and amount as each role. The deal owner is told, once, that a payment is overdue; that message
has no invoice number and no amount.

## Tables

| Table | What | Notes |
|---|---|---|
| `invoices` | Number, amount, currency, issued and due dates, company, usually a won deal | `status` is DRAFT, SENT, PART_PAID, PAID or VOID. **OVERDUE is never stored**: it is derived (see below). Unique number per organisation (case-insensitive). |
| `payment_records` | Money received against an invoice | Append-only. A mistake is **reversed** with a reason (`reversed_at`); the row stays. |
| `deal_payment_notes` | The one "next" follow-up note Finance keeps on a won deal, with an owner and a date | Departure 1.5: a note instead of tasks. |

Every table has row-level security and composite keys, so an invoice can only point at records of its own organisation
(`tests/payments.test.ts`, `tests/stage3ExitGate.test.ts`).

## Rules (`src/lib/payments.ts`, pure and tested with a fixed date)

- **Overdue** = the invoice is SENT or PART_PAID, still has a balance, and its due date is before today.
- Amounts are added in whole cents. Money is returned as two-decimal strings.
- **The sum of payments can never exceed the invoice** unless the caller sends `allowOverpayment`; the invoice then
  remembers it. Two payments recorded at once cannot both fit (the invoice row is locked).
- A draft cannot receive a payment ("mark it sent first"); a void invoice cannot change.
- **Void** keeps the invoice and its history and is refused while payments are recorded; reverse them first.
- The status follows the payments: all received is PAID, some is PART_PAID, none is SENT. Reversing a payment moves it back.
- An invoice links to a **won** deal (or only to a company, for example a renewal).
- Every change is audited with before and after (`invoice.created`, `invoice.updated`, `invoice.sent`, `invoice.voided`,
  `payment.recorded`, `payment.reversed`, `deal_payment_note.*`). The audit reader (M4) must hide `PAYMENT_ENTITIES`
  (`Invoice`, `PaymentRecord`, `DealPaymentNote`, listed in `src/auth/masking.ts`) from roles without `finance.view.payments`.

## Endpoints

| Route | Purpose |
|---|---|
| `GET /invoices` | List: filters `status` (including OVERDUE), `overdue`, `companyId`, `dealId`, `dueFrom`, `dueTo`, `q`; sort `dueOn`, `issuedOn`, `amount`, `number`, `createdAt`; totals by status; "nothing to collect" state |
| `POST /invoices` | Create (idempotent) |
| `GET`, `PATCH /invoices/{id}` | Read with payments; edit (the amount cannot fall below what was received) |
| `POST /invoices/{id}/send`, `/void` | Draft to sent; void with a reason |
| `POST /invoices/{id}/payments` | Record a payment (idempotent) |
| `POST /payments/{id}/reverse` | Reverse with a reason |
| `GET /invoices/export` | CSV; above 500 rows needs `export.bulk` (Management) |
| `GET /payments/summary` | Due this week, overdue, collected this month, still owing (also on the Finance dashboard) |
| `GET /payments/deals` | Won deals with invoiced, received, outstanding and the next note |
| `GET`, `PUT`, `DELETE /deals/{id}/payment-note` | The next note |

## Overdue reminders

`reminders.sweep` (daily) tells Finance (Management when there is no Finance member) once per invoice and due date,
and tells the deal owner without an amount. A changed due date is a new trigger. Switch it off in `reminder-settings`
(`overdueInvoices.enabled`).
