# Role dashboards

Screen: `src/ui/screens/home/Home.tsx`; the commercial and social widgets are in `src/ui/screens/home/widgets.tsx`. Design: CrmDashboard, CrmBilling, CrmOrgDesign.

The API decides which section a role gets (`getDashboard`); the screen picks the home from the section that is present. A widget a role cannot see is omitted, never shown empty (rule 7).

| Role | Home | Added by the universal CRM programme |
|---|---|---|
| Management | `management` section | Invoice tiles (invoiced, collected, overdue); Quotes panel (awaiting approval, sent, accepted); Social snapshot (followers, mentions needing a reply) |
| Sales | `sales_today` section | My quotes (draft, sent, accepted) with New quote; Invoice drafts to prepare (won deals without an invoice) with New invoice |
| Delivery | `delivery` section | none |
| Finance | `finance` section | Invoice tiles (invoiced, collected, overdue); Ageing panel (outstanding and the five buckets) |
| Restricted Technical | `technical` section | none |
| Marketing (`social.view`, role MARKETING) | The Social overview (`SocialHome.tsx`) | New. |

## Masking

- Invoice figures need `invoices.view` and `finance.view.payments` (Finance and Management only).
- The Sales invoice-drafts panel lists customer names only, no amounts.
- Quotes need `quotes.view`; New quote needs `quotes.create`; New invoice needs `invoices.create`.
- The Social snapshot needs `social.view` and, while on demo data, the demo screens switch (`NEXT_PUBLIC_DEMO_SCREENS`).

## Data

- Invoices and won-deal payments: real API (`listInvoices` totals, `listWonDealPayments`).
- Quotes: the quotes demo store (`commercial/demo/store.ts`) until quotes are wired.
- Social snapshot: `src/ui/screens/home/demo/data.ts` (demo).
