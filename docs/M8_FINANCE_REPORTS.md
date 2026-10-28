# M8 payments tracker and reports (F3.06, F3.07)

Issues: FIG-1100 (F3.06, Payments tracker, design F1) and FIG-1101 (F3.07, Organisation reports, design R1; the UI half of FIG-793, customer reports). Design: `design-spec/CrmWorkspaces.dc.html` (Finance payments), `CrmReports.dc.html`, `crm-theme.css`. Code: `src/ui/screens/finance/` (stylesheet `finance.css`) and `src/ui/screens/reports/` (stylesheet `reports.css`), routes `payments` and `reports`. Both pages are thin server components; the screens are client components on `@/ui` and the frozen API (typed client, no `fetch`).

## Payments tracker

- **Who sees it:** `finance.view.payments` (Finance, Management). Any other role gets the explained no-access state and the screen makes no API call at all, so no figure is ever requested. A 403 from the API shows the same state with the API's own "who to ask". Changing things needs `finance.manage.payments`; the follow-up note needs `finance.followup.note` or manage. A view-only role sees the invoices and a "Details" button, nothing that changes them.
- **List:** one row per won deal (`GET /payments/deals`): company, service, won date, CONTRACT, PAID, BALANCE and a status pill (Overdue, Awaiting payment, To invoice, Paid in full). Status tabs with counts, a search box and paging (50 a page). Tabs and search filter the loaded page; the API has no state filter on that route.
- **Headline figures:** Contracted (sum of the won deals on the page), Invoiced and Collected (from the invoice book's totals by status), Awaiting and Overdue (`GET /payments/summary`).
- **Open a row:** its invoices (`GET /invoices?dealId=`), the one "next" follow-up note (set, edit, clear: `PUT`/`DELETE /deals/{id}/payment-note`) and "Open customer".
- **Invoice actions:** Mark sent (draft), Mark paid in full (records the balance as one payment), and Manage/Details, which opens the invoice dialog: amount, received, balance; payments received with Reverse (reason required, the record stays struck through); Record a payment (amount, date, a label, a reference; empty amount means the full balance); Void (reason, refused by the API while payments exist); and the audit trail for Management (`audit.view`). Other roles are told the audit history is read by Management. Overpayment is refused by the API and its message is shown.
- **Customer 360 follows:** every payment change invalidates the payments reads, `getCustomer360`, the company and lifecycle reads, so a company page open in another tab of the app reads the new state on its next fetch.
- **Notification link:** `/o/{org}/payments?invoice={id}` (the overdue notification's path) opens that invoice's dialog.
- **Nothing is processed:** the tracker says so in the design's note; a payment's method is a free label and the form says never to enter account or M-Pesa details.

## Reports

- **Who sees what:** `reporting.view.all` (Management) gets the organisation reports; `reporting.view.own` gets My metrics (the R2 screen, unchanged); no reporting permission gets the explained no-access. Restricted figures come back hidden from the API (`valueMasked`, `null` money) and the screen prints "Hidden", never a figure or a sum.
- **Page:** header with scope pill and Export CSV (`export.bulk`, `GET /reports/export`); Needs attention tiles (`GET /reports/my-work`: overdue, due today, new leads, stalled deals); period control (7, 30, 90 days, 12 months) and owner/source/stage/service filters; headline figures (`GET /reports/organization`: leads created, conversion, won deals, win rate, open pipeline, follow-ups done); report cards (`GET /reports/v2`): lead volume by source, conversion by stage and by source, pipeline by stage, lost reasons, per person, this month against last, customers, renewals; follow-ups by status; and the customer reports (`/reports/customers`, `/reports/renewals`, `/reports/sales-by-salesperson`) as tables with a segment, window and monthly-split control.
- **Chart or table:** every card has the toggle. The chart is drawn from the same series the API builds from the table's rows; each bar carries its label and its figure, so colour is never the only cue, and the picture has one sentence for screen readers. The table view adds the totals row. `MONTH_VS_LAST` mixes units (counts, percent, money), so it is a table only.
- **CSV equals the table:** report cards link to the API's CSV of that report (`/reports/v2/{KEY}/export`, the same columns and rows plus the totals row, audited, under the bulk-export rule). The customer tables write the table as shown (`tableToCsv` in `model.ts`, unit tested against the visible cells). A masked column is "Hidden" in both.
- **Colour:** bars use one hue (the brand green) unless the bar stands for something: Active green, Repeat purple, Dormant orange for customers; Lapsed red, Due soon orange for renewals; lost reasons red. Checked with the dataviz validator: the three-colour sets pass CVD and normal-vision separation. The brand green is darker than the validator's lightness band and its chroma is low, and orange on white is 2.2:1; both are the approved design's colours, and the validator's rule for that case is met: every bar has a visible label and figure and a table view exists.

## States

Loading skeleton, error with Retry ("Reports didn't load"), "Not enough data yet", per-card empty text, no-access (explained), and per-card failure for the customer reports, so one failed read leaves the rest of the page.

## Decisions taken without asking

1. **Filters.** The API's organisation figures accept owner, source, stage and service; the v2 reports accept only the date range. The filters therefore apply to the headline figures; a line under the range says so when one is set.
2. **Design parts the API does not give:** the Expected revenue KPI (weighted pipeline), first response time, conversations by channel and margin on won deals have no endpoint, so they are not shown. Follow-ups are shown as a status breakdown, not "done on time".
3. **Payments balance** is invoiced minus received (the API's `outstanding`), not contract minus paid; Contracted is the deal value. A deal with no invoice yet shows its full contract as To invoice with balance 0.
4. **Design status select** (Not invoiced, Sent, Paid, Overdue) maps to what the API really does: Overdue is derived from the due date and cannot be set; Paid is a recorded payment that can be reversed. So the select is replaced by the status pill and the actions above.
5. **Add payment follow-up** is a dialog with a note and a date (the design sets a fixed "in two days" note); owner defaults to the person saving.
6. **No page-view label** for Payments (the label list belongs to the usage metric).
7. The old server-rendered Reports page, `reports/charts/ReportBarChart.tsx` and `ReportDonutChart.tsx` are no longer used by any page; they and their tests stay until someone decides to remove them.

## Tests

`tests/components/screens/finance/payments.test.tsx` (9) and `tests/components/screens/reports/` (`model.test.ts` 7, `reports.test.tsx` 7), run with `vitest.finance-components.config.ts` (no database): per-role access and masking, no API call for a role without permission, paid-in-full records the balance and refreshes, notes, filters, CSV equals the table, chart and table agree, empty and no-access states, axe on both screens. `e2e/payments.spec.ts` and `e2e/reports.spec.ts` cover per-role journeys against a real database (Finance marks paid and Customer 360 follows, reversal, follow-up note, Management audit trail, no-access for Sales, Delivery and Technical, numbers equal the API, CSV equals the table, axe).

## Known gaps

Contracted is summed over the loaded page of won deals; status tabs filter that page only (no state filter on the API route). No Expected revenue, response time, channel or margin reports (no endpoints). `exportInvoices` is not offered on the tracker (the client cannot download it: the operation is typed JSON, not CSV).
