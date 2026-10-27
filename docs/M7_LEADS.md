# M7 · Leads screens (F2.01, F2.02, F2.03)

FIG-1083 (list, bulk actions, archived tab, shared pool; design L1), FIG-1084 (lead page, progress strip, qualification; L2), FIG-1085 (drawer, convert, lost reason, import and export; L3). Design source: `design-spec/CrmLeads.dc.html` and the lead drawer and dialogs in `design-spec/CrmOverlays.dc.html`.

## Where things are

| What | File |
|---|---|
| Routes (thin, server) | `src/app/o/[orgSlug]/leads/page.tsx`, `leads/[leadId]/page.tsx` |
| List | `src/ui/screens/leads/LeadsScreen.tsx` |
| Lead page | `LeadDetailScreen.tsx` |
| New lead / Edit lead drawer | `LeadDrawer.tsx` |
| Convert, Mark lost | `ConvertDialog.tsx`, `LostDialog.tsx` |
| Import wizard, export | `ImportWizard.tsx`, `csv.ts`, `ExportDialog.tsx` |
| Log a call or note, New task (from a lead) | `QuickDrawers.tsx` |
| Overlay shells (drawer, modal) | `overlay.tsx` |
| Lookups, permissions, dates | `data.ts`, `format.ts`, icons `icons.tsx`, styles `leads.css` |

Everything reads through the typed client (`useApiQuery` and friends) and `useMember()`; nothing calls `fetch`. A role the API refuses gets the explained no-access from the API's own 403.

## Behaviour

- **List:** tabs All, Hot, Shared pool (Sales, marked PROVISIONAL) or Unassigned (Management), Converted, Archived, with counts (one-row count queries). Search, status, temperature, source and owner (Management) filters run on the server; columns can be sorted (Temperature, Next follow-up) and hidden; saved filters and the column choice are kept on this device. Paged on the server (25, 50, 100), so a 50,000-lead organisation loads one page at a time; the design's "large lists load N rows at a time" note shows above 1,000. `?q=` and `?view=` in the URL are honoured (search and old links).
- **Per role:** Sales sees their own leads plus the pool, the owner is text with a lock and the reason; Management sees everything, can reassign from the row, in bulk and on the page, imports and exports. A control the role may not use is disabled with the reason, never silently hidden (Archive, Convert).
- **Bulk bar:** Reassign, Tag as, Archive (disabled with the reason when nothing selected may be archived), Export selected (a CSV of the selected rows), Clear. Partial failures are counted in the toast.
- **Lead page:** the progress strip is the server's (`GET .../qualification` `progress.stages`: New, Contacted, Needs Identified, Qualified, Converted, with Unqualified/Lost/Inactive shown off the strip). Moving to Qualified with required-on-qualify answers missing shows the list of what is missing and does not call the API; the server's own message is shown if it refuses anything else. Answers save as you type. A converted lead's strip is locked; an archived lead is read-only with a Restore button for people who may archive it. The duplicate warning (an open deal for the company) is only a warning. Score explanation, tasks, contact card, timeline (Activity, Communications, Audit history for people with `audit.view`). `<div data-slot="record-extras">` is the mount point for F3.08 (M8).
- **Convert:** shows what comes along, asks only for what is missing, shows duplicate matches without blocking, and sends the person to the new deal.
- **Import:** pick or drop a file, check the column mapping (pre-filled from the design's own column names), import 500 rows at a time with real progress and a Stop button, then the summary, the list of rows that need a look and the downloadable error report. Row numbers in the report are file rows.
- **Export:** up to 500 rows downloads at once. Above that: Management (`export.bulk`) starts a background export; anyone else is routed to an approval request and sees its status (waiting, approved, declined).

## Decisions taken without asking

1. **Progress strip order** follows the API (New, Contacted, Needs Identified, Qualified, Converted); the prototype draws New, Qualified, Contacted, Needs Identified, Converted. The API is the contract.
2. **No Service filter.** `GET /leads` has no service filter, so a Service dropdown would only filter the page on screen. The column is shown; adding `serviceInterestId` to `ListLeadsQuerySchema` is a one-line backend change if you want the filter.
3. **"All" includes converted leads** (the prototype's All excludes them). The API cannot exclude a status, and filtering one page in the browser would lie about the totals. Converted leads carry the Converted status chip, and the Converted tab lists them alone.
4. **Convert asks for a Service, not a Deal title.** A deal has no title in the API (convert takes service, value, expected close). The Value field is always shown: the person converting owns the new deal, and an owner always sees its value (`docs/MASKING.md`).
5. **New lead:** the name becomes (or is matched to) a company, because a lead's name is its company. A role that may not create companies is told so and keeps the form. The phone is saved on a new company only. Edit does not rename the company or change phones (those belong to the company and contact pages).
6. **Lost note:** the optional note is saved as a timeline note ("Marked lost").
7. **Owners** offered for assignment are the members whose role is Sales or Management plus the signed-in person (the reference call omits the person themself). A dedicated assignable-owners endpoint would be cleaner.
8. **Hover colours:** the older stylesheet styles bare `button:hover`, `td`, `label` and `.page select`; `leads.css` re-asserts each control's resting look and uses a `.fb-app` prefix to out-rank those rules (see the last block of the file). A global fix (scoping the legacy rules to `.legacy`) belongs to a later clean-up.

## Known gaps

- **Large exports:** after `POST /exports` the file can only be fetched at `/api/orgs/{org}/data-runs/{id}/download` (a plain link), and the run's status cannot be polled: `data-runs` routes are not in the frozen contract. Needs `getDataRun` added to the contract (changelog note) so the dialog can show progress.
- **Approvals:** an approved export request cannot be redeemed through `POST /exports` (its body does not accept `approvalId`); the dialog says "Approved" and tells the person to ask Management to run it.
- **Duplicate flag on list rows** is not shown: there is no per-row duplicate field on the list; the duplicate warning appears in the New lead drawer, the Convert dialog and on the lead page.
- **Virtual rows:** not needed (server paging keeps at most 100 rows in the DOM); if a future design wants infinite scroll it will need the cursor the API already returns.
- The 375 px table scrolls inside its card (as designed); the lead page stacks.

## Tests

- `tests/components/screens/leads/` (40 tests): list per role and state, pool, bulk, paging, archived tab; lead page (strip, qualification message, duplicate, archived, converted lock, read-only, audit tab); drawer, lost, convert, import (including batching and error row numbers), export; axe on each main screen. Run with `npx vitest run --config vitest.leads-components.config.ts` (a config without the Postgres global set-up; delete once M7 is merged).
- `e2e/leads.spec.ts` (per-role list, create, archive/undo/restore, bulk reassign, qualify with a missing required answer, lost reason, convert with inline company, import with report, export). `e2e/lead-lifecycle.spec.ts` was updated for the new lead steps (create from the drawer, assign from the lead page, convert from the dialog); its deals steps belong to the deals work.
