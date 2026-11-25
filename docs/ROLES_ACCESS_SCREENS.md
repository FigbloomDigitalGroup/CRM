# Roles & access screens (UC-C2, UC-C4, UC-C5, UC-C6)

Three new Settings tabs, Management only, in `src/ui/screens/roles/` (one stylesheet, `roles.css`). Open them at `/o/{org}/settings?tab=rolesaccess`, `?tab=salesaccess` and `?tab=structure`.

## What is real

**Roles & access** (`?tab=rolesaccess`, FIG-1790, FIG-1816) runs on the existing roles API, with no change to it:

| Part | Route |
|---|---|
| Roles list (five standard roles read-only, custom roles, people per role, permission count) | `GET /orgs/{org}/roles` |
| Permission catalogue, reserved keys with the API's reason, starting points, limits | `GET /orgs/{org}/roles/catalog` |
| Add role (name, description, start from a standard role or a starter template, switches per area, deal value rule) | `POST /orgs/{org}/roles` (idempotency key per click) |
| Edit a custom role | `PATCH /orgs/{org}/roles/{id}` |
| Archive (refused while people hold the role; the button says so) | `DELETE /orgs/{org}/roles/{id}` |
| "What can this role access?" (live, 300 ms after each change; the API's refusal is shown as is) | `POST /orgs/{org}/roles/preview` |
| Sidebar part of the preview | the shell's own `buildNav` over the previewed key set, so it cannot drift from the real navigation |
| Members by capability: who can do a chosen permission (people reached) and a permissions-held-per-role table | built from the real role list (`permissionKeys`, `memberCount`) |

Starter templates ("Marketing lead", "Read-only analyst") are lists of EXISTING keys in `model.ts`, filtered to what the catalogue lets an organisation grant and validated again by the API on save. They add no key and change no role.

Nothing in the API is weakened. Reserved keys stay disabled; platform roles are read-only; the 25-role limit and the "a change key needs its view key" rule come back from the API and are shown.

**Caveats of the real part**
- The routes are gated by the **`roles.custom` toggle (V1.1 and later)** (`resolveGatedContext(..., "release.v2")`) and `roles.manage`. An organisation not on V2 sees the "not available yet" state. On the MVP (V2 hidden) the tab therefore shows that state until the flag moves (conflict with `DECISIONS 7.1`, D-7).
- The API does **not** check that an admin only grants keys the admin holds. Custom roles can only carry non-reserved keys, which Management already controls, so nothing was added. A "grant only what you hold" rule would be a backend change.
- Custom role keys are still globally unique (`Role.key`); namespacing per organisation (rest of FIG-1790) is a backend task.
- The members list per role (names, "change role") is not on this tab: the preview shows names for an edited role and Members already changes roles.

## What is demo

Both screens carry a "Preview only" badge and banner, save nothing, and keep their data in `roles/demo/data.ts` (search `roles/demo/`).

- **Sales access** (`?tab=salesaccess`, FIG-1789): the 13 participation switches, dependent switches that lock with the reason, four scenarios (Marketing off, Marketing sourcing and qualifying and transferring, Technical assisting and scoping, Sales unchanged), and a live preview of sidebar, home tiles and lead and deal drawers. The sidebar is the real `buildNav`. Switches 1, 4, 6, 7, 10 and 13 map to keys that exist (`leads.create`, `leads.assign`, `deals.create`, `deals.edit.own`, `quotes.create`, `deals.view.value`). Switches 2, 3, 5, 8, 9, 11 and 12 map to keys that do not exist yet and only drive the descriptive parts of the preview. With financial visibility off, "My pipeline value" is omitted and "Won this month" shows a count.
- **Organisation structure** (`?tab=structure`, FIG-1787): departments, heads, member seats, one person in several departments, add and archive. A department gives no access.

## What backend remains (not built, no migration or key added today)

- **UC-C1 (FIG-1786)** departments tables and API (`departments`, `department_members`, `department_policies`) and a `departments.manage` key (reserved). Needed to save the Organisation structure tab and to store a participation policy.
- **UC-C3 (FIG-1788)** the new sales participation keys: `leads.source.set`, `leads.qualify`, `leads.transfer`, `deals.assist`, `deals.scope`, `deals.stage.move`, `deals.close`, seeded so every role's effective keys are unchanged, with the snapshot test of `UNIVERSAL_CRM_ARCHITECTURE.md` 6.3, plus the `sourced` and `assisted` visibility scopes. Then the Sales access screen reads and writes the policy and the preview uses the real resolver.
- **UC-C5 rest (FIG-1790)** per-organisation role key namespace; releasing the roles API beyond V2.
- **UC-C7 (FIG-1791)** the Marketing role and its `marketing.*` and `social.*` keys; the "Marketing lead" starter template then becomes a real role template with those keys.
- A people-by-role list and "assign to" on the roles tab (design frame RL2) once a members-by-role read exists; today use Settings, Members.
- Field rules stay `deal.value` only (`DECISIONS 9.2`).

## Tests

`tests/components/screens/roles/roles.test.tsx` (components project, stubbed API): list, add role from a starting point and the create body, reserved key disabled, standard role read-only, archive disabled while in use, the API's refusal shown in the preview, the not-available state, switch dependencies, home tiles and sidebar rules, department add and archive, axe on the list and Sales access.

## 25 Nov 2026: brought forward from V2 (Given)

- The roles routes (`/roles`, `/roles/{id}`, `/roles/catalog`, `/roles/preview`) and `/memberships/{id}/permissions` are gated by the organisation toggle `roles.custom` (V1.1 and later, default on) instead of `release.v2`. An organisation on V1.1 (the MVP) now sees the tab; a V1 organisation still gets the explained not-available state. Switch it off per organisation in Platform, Flags.
- The tab is a role list on the left (standard roles and your roles with people counts, New role, Grant all, Revoke all) and one role's editor on the right: name, description, search, category, Copy from, the pages the role opens, a collapsible Preview as this role, who has the role, and permission cards by area with an n / m Active count. Same API, same reserved keys, same preview. Save is explicit (one Save changes button), not per click, so the API can refuse a bad set as a whole.
- Not changed: platform roles stay read-only; only Management (`roles.manage`) edits; reserved keys cannot go on a custom role. There is no separate Switch off and Delete role: Archive role is the one action, refused while people hold the role.
- `roles.manage` moved from `v2` to `v1.1` in `PERMISSION_MIN_RELEASE` (`prisma/seedData.ts`). Without that, Management on a V1.1 organisation carried no `roles.manage` and saw the no-access state (found 26 Nov 2026 on production). `tests/roleMatrixLive.test.ts` ("Roles & access on a V1.1 organisation") guards it: Management lists, creates, previews, edits and archives; Sales is refused.
