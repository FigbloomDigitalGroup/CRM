# Multi-organisation membership and the organisation switcher (FIG-1133, B6.01)

Design reference: TB4. Decision gate: stays in V1.1 unless P1.10 moves it (FIG-1132 is still open; Given approved starting anyway).

## Model

No new table. One person is one `users` row with any number of ACTIVE `memberships`, each with its own role. The session carries the open organisation in `sessions.organization_id` (set at sign-in to the oldest active membership). Every request still takes its organisation from the URL slug and checks the caller's membership in it (`resolveRequestContext`), and the database enforces the organisation with row-level security. The switcher therefore changes what the shell opens and the context it draws, never what a route may read.

## API

- `GET /api/me/organizations`: the person's own active memberships only: `slug`, `name`, `membershipId`, `roleKey`, `roleName`, `current`. Nothing else about any organisation; deactivated, pending and removed memberships and inactive organisations are left out.
- `POST /api/me/organizations/switch { organizationSlug }`: one atomic update of the session's organisation, then the new organisation's whole context (role, permissions, look, preferences, features: the `/api/me/context` shape) in the same answer, with the context cache invalidated. A slug the caller has no active membership in answers exactly like an unknown slug (404), so the call cannot reveal which organisations exist; an inactive organisation is a 400. A revoked session or another person's session cannot be moved. Needs a real session (not the dev-cookie fallback).
- Audit: `auth.org_switched` in BOTH organisations, each entry holding only `direction: left` or `entered`: neither names the other organisation. Switching to the open organisation writes nothing.
- `GET /api/me/context?org=<slug>` already opened another organisation; unchanged.

V1 behaviour is unchanged: a single-organisation person sees a list of one and switching is a no-op.

## Decisions taken without being asked

Not gated by the release flag (the list for one organisation is harmless); two-step policy is evaluated across all of a person's organisations, so one organisation that requires it applies at sign-in to the person (the sign-in cannot know which organisation will be opened); session lifetime stays the person's session, not reset by a switch.

## To wire

Wired on 5 Nov 2026 (M14, W6): `OrgSwitcher.tsx` uses both routes and opens `/o/<slug>`; the layout mounts it when the person has more than one organisation.

## Tests

`tests/organizationSwitcher.test.ts` (12): own memberships only, role per organisation, leaving out inactive states, single-organisation no-op, atomic switch with role and permissions changing, both-sided audit without cross-naming, RLS data scope, cross-organisation attacks (indistinguishable 404, no session change, no victim audit, deactivated and pending and removed, someone else's or a revoked session, the URL organisation still checked), the routes.
