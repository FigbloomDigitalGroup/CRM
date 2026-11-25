# Per-member permission overrides (UC-C5 step 3, FIG-1790)

Management can add (GRANT) or remove (DENY) single permission keys for ONE member on top of that member's role. Example: Mark Mutesa is Sales
but also gets `social.view`, or loses `invoices.create`. The member's sidebar and dashboard follow, because they are driven by the effective keys.

## How it resolves

`effectivePermissionKeys` (`src/auth/permissions.ts`) takes an optional `overrides: { grant, deny }`. Order: role keys, departures, implied keys,
release filter, then GRANT keys are added (with their implied keys, release-filtered), then DENY keys are removed. So a DENY always wins.
`resolveActiveMembership` reads the overrides in the same SQL statement as the role keys (two correlated sub-selects), so a change is effective on
the very next request. Overrides saved for a key the organisation's release does not yet include are inert. At resolution time a GRANT of a
reserved key is ignored as a second line of defence.

## Table

`membership_permission_overrides` (migration `20261201090000`): `id`, `organization_id`, `membership_id`, `permission_key`, `effect` (`GRANT` or `DENY`),
`created_by`, `created_at`; unique `(membership_id, permission_key)`; composite foreign key to the membership; forced RLS with the standard tenant policy;
`figbloom_app` gets the table through the repo's `grant-role` script (all tables). Listed in `organisationExportTables.ts` and in the V1.1 tenant attack list.

## API (V2, `role.assign`, i.e. Management)

- `GET /orgs/{org}/memberships/{membershipId}/permissions` (`getMemberAccess`): `{ membershipId, roleKey, roleKeys, grant, deny, effectiveKeys }`.
- `PUT` same path (`setMemberAccess`), body `{ grant: string[], deny: string[] }`: replaces the whole set, so it is idempotent. One audit event
  `membership.permissions_overridden` (previous and new sets) only when something changed; the me-context cache of the organisation is cleared.

## Rules (all refused with an explained 400)

- GRANT: the key must exist, must not be reserved (`ADMIN_RESERVED_KEYS`, and `SENSITIVE_RESERVED_KEYS` which covers payments and margin: rule 7; the same
  `roleLimits.ts` lists custom roles use), and the grantor must hold it. Masking keys such as `deals.view.value` can be added because Management holds them.
- DENY: any known key, except that the keys that run the organisation cannot be removed from a Management member (no lock-out).
- A key cannot be in both lists. A change right whose view right the change removes (or adds without a view right) is refused, as on custom roles.
- You cannot change your own overrides. A membership of another organisation answers 404. Non-Management gets 403.

## Decisions

- Changing the member's role KEEPS the overrides. They are a per-person adjustment ("Mark also does social"), not part of the role; Reset in the drawer clears them.
  A redundant override (GRANT of a key the new role already has) is harmless.
- A custom role's own field rule `deal.value: hidden` still wins over a granted `deals.view.value` (the rule is read from the role).
- PUT tolerates redundant entries instead of rejecting them, so a form built from an older GET can still be saved after a role change.

## UI

Settings, Members: a "Customise access" button per active or invited row opens a drawer (`src/ui/screens/settings/MemberAccess.tsx`) with the permission
catalogue grouped by area, three states per key (Inherited from role, Add, Remove), a summary of the changes, Save and Reset. Keys that cannot be
added are disabled with the reason.

## Tests

`tests/membershipOverrides.test.ts` (database) and `tests/components/screens/settings/memberAccess.test.tsx`.
