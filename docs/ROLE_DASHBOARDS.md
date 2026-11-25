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

## Dashboard widget picker (UC-W1, FIG-1802)

Management chooses, per role, which widgets show on that role's home and in what order: Settings, **Dashboards** (`/settings?tab=dashboards`, `src/ui/screens/settings/Dashboards.tsx`).

- **Catalogue:** `src/ui/screens/home/catalogue.ts` lists every tile and panel (id, title, description, required permission keys, the homes it may appear on, default order, full-width or panel). Pure code, shared by the screen, the API and the tests. Marketing's home is one locked widget (the Social overview).
- **Storage:** one organisation setting row `dashboard.layouts` (no new table): `{ <home>: [{ id, visible }] }`, in order. A home with no entry uses the catalogue default, so nothing changes until Management edits, and widgets added to the catalogue later appear at their default place.
- **API:** `GET /api/orgs/{org}/dashboard-layouts` returns the caller's own home's layout, already filtered by their permission keys. Management may add `?kind=` to read another role's home (configuration only). `PUT` (Management, `configuration.manage`) takes `{ kind, widgets }`, or `widgets: null` to reset; it is idempotent (same body, same state, one audit entry) and audited as `dashboard_layout.updated`.
- **Masking (rule 7):** the picker can only hide or reorder. `resolveLayout` drops every widget the reader's keys do not grant, on the server (GET) and again in `Home.tsx` (`layout.tsx`); a stored layout can never reveal anything. The Dashboards tab says so. Tests: `tests/dashboardCatalogue.test.ts`, `tests/components/screens/home/homeLayout.test.tsx`, `tests/dashboardLayouts.test.ts` (database).
- **Home:** `LayoutBody` (`src/ui/screens/home/layout.tsx`) renders the widgets in the saved order; consecutive panels sit two to a row, full-width widgets alone. A widget the layout hides is never mounted, so it fetches nothing. If the layout cannot be read, the default is shown.
