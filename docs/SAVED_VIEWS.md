# Saved views, personal and shared, pinned in the sidebar (FIG-1148, B6.16, design X4)

V1.1. Code: `src/lib/savedViews.ts` (pure rules), `src/services/savedViewService.ts`, `src/repositories/savedViews.ts`,
migration `20261108134200_saved_views` (tables `saved_views`, `saved_view_pins`, both with RLS).
The screens (`src/ui/screens/views/`) read and write these routes (wired 5 Nov 2026, `store.ts`); the pure model stays. Only the Leads list saves views so far.

## Routes (outside the frozen V1 contract; create accepts `Idempotency-Key`)

| Route | What |
|---|---|
| `GET /api/orgs/{org}/views?entity=&pinned=true` | Views the caller may use; `pinned=true` is their sidebar, in their order |
| `POST /api/orgs/{org}/views` | Create `{entity, name, scope?, filters?, sort?, columns?, pinned?}` |
| `GET` / `PATCH` / `DELETE /api/orgs/{org}/views/{id}` | Read; rename, change, share or unshare (owner only); delete (owner only) |
| `PUT /api/orgs/{org}/views/{id}/pin` | `{pinned}` pins or unpins in the caller's own sidebar |
| `PUT /api/orgs/{org}/views/pinned-order` | `{ids}` the caller's pinned views in order (every pinned view exactly once) |

Lists a view can be for: `leads`, `deals`, `companies`, `contacts`, `tasks`. Everything needs release V1.1.

## Rules

- A view holds a list set-up (filters, sort, columns, at most 4,000 characters), never records. Opening it runs the viewer's own list query, so the data is always the viewer's own.
- **Personal** views are seen by the owner. **Shared** views are seen by every member whose role may open that list (`leads.view.*`, `deals.view.*`, `companies.view`, `contacts.view`, `tasks.view.*`). Anyone else, and anyone in another organisation, gets 404 (the same answer as a view that does not exist).
- Sharing needs `views.share` (Management and Sales). Only the owner renames, changes, shares, unshares or deletes; anyone else gets the explained 403.
- **Nothing beyond the role.** A filter, sort or column that needs a permission the viewer lacks is removed for that viewer and counted in `hiddenParts` (values and amounts need `deals.view.value`, margin and cost need `deals.margin`, payment, invoice and balance need `finance.view.payments`; matched by name in `restrictedKeyPermission`). A person cannot save a view that uses such a part themselves (422 `FIELD_NOT_VISIBLE`), so the set-up of a shared view can never carry a hidden value in it.
- **Pins** are per person with a position. Anyone who can see a view can pin it for themselves. Unsharing removes everyone else's pin; a person who loses the right to open the list no longer gets the view in their sidebar. Deleting a view or a member removes the pins.
- Names are 1 to 40 characters and unique per person per list (case-insensitive); at most 50 views per person.

## Tests

`tests/savedViews.test.ts`: authorisation by role in both directions (private, shared, not-the-owner, no `views.share`, roles with no list), restricted parts removed for the viewer, pins per person and reordering, release gate, tenant isolation in the service and under RLS.
