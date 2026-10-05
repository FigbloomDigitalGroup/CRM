# Tenant offboarding and data export

What to do when a subscriber organization's engagement ends -- whether
that's the end of an external pilot (see `documents/FIG-444 Subscriber
Readiness Plan and External Pilot Criteria.md`, §12 "Export & Pilot Exit")
or a paying tenant churning later. This is a different thing from
`docs/DATA_DELETION_REQUESTS.md`: that document is about one *person's*
data inside an organization that keeps operating; this one is about an
entire *organization's* access and data at the end of its relationship
with FigBloom.

Two independent steps, run in whichever order (or combination) the
situation calls for:

- **Export** (`scripts/export-organization.ts`) -- hands the tenant their
  own data back. Never deletes or changes anything.
- **Offboarding** (`scripts/offboard-organization.ts`) -- revokes access.
  Never deletes any business data.

Running one does not imply the other. A tenant who churns but whose
contract requires FigBloom to retain their data for a period gets
offboarded without being exported (not their choice to delete nothing, it
just isn't being handed back right now) or without data being touched at
all; a tenant who wants a copy of their data mid-engagement, not at
offboarding time, gets exported without being offboarded.

## Step 1: Export (if the tenant needs their data back)

```bash
npx tsx scripts/export-organization.ts --org <slug>
# or specify where to write it:
npx tsx scripts/export-organization.ts --org <slug> --out ./exports/acme-final
```

Writes one CSV file per entity type (`companies.csv`, `contacts.csv`,
`leads.csv`, `deals.csv`, `activities.csv`, `tasks.csv`,
`communications.csv`) to the output directory, every row scoped to that
one organization. Includes archived/soft-deleted records -- an offboarding
export should be complete, not just what the product's default list views
currently show.

This is deliberately **not** the same code path as the per-record CSV
exports reachable from the product UI (`src/services/exportService.ts`,
gated by `companies.export`/`contacts.export`/etc. and masking deal value
for roles without `deals.view.value`). Those are for a logged-in member
exporting what *they're* allowed to see; this script is a platform/admin
operation with no authenticated caller, run by whoever has direct
server/database access, and intentionally exports everything unmasked --
the whole point is to hand the tenant back the complete, real data they're
entitled to.

Columns are the raw database fields (including foreign-key ids, not
resolved display names) -- a full data handoff, not a human-facing report.
If the tenant specifically needs human-readable names instead of ids,
cross-reference against that same export's `companies.csv`/etc., or the
reference-data catalogs under Settings at the time of export.

**Rows exported, not rows guaranteed retained elsewhere:** this script
only reads and writes CSV files; it has no effect on what still exists in
the database. Whether exported data is later deleted from FigBloom's own
database is a separate decision (see "Retention after offboarding," below)
-- this export is not itself a deletion mechanism, unlike
`erase-data-subject.ts`.

## Step 2: Offboarding (revoke access)

```bash
# Dry run first -- always. Prints exactly what would change, changes nothing.
npx tsx scripts/offboard-organization.ts --org <slug>

# Only once the dry-run output looks right:
npx tsx scripts/offboard-organization.ts --org <slug> --confirm
```

What this actually does:

- **Deactivates every active membership** in the organization
  (`Membership.status -> INACTIVE`). This is what actually blocks access
  for every person in that org -- `resolveActiveMembership` (the function
  every authenticated request resolves through) only ever matches an
  `ACTIVE` membership, so a deactivated one can no longer log in or act in
  this organization at all, regardless of the organization's own status.
- **Marks the organization itself `INACTIVE`**
  (`Organization.status -> INACTIVE`). This additionally blocks the
  organization's two public, session-less integrations -- the website
  lead-capture endpoint and the inbound-email webhook -- both of which
  explicitly check `organization.status === "ACTIVE"`
  (`src/auth/websiteApiKey.ts`, `src/auth/inboundEmailKey.ts`) before
  accepting a request. Without this, those two endpoints would keep
  accepting submissions for an org whose members can no longer act on
  them.

**No business data is deleted by this script.** Companies, Contacts,
Leads, Deals, and everything else remain exactly as they were -- this is
revoking access, not erasure. Reactivating a specific membership later
(e.g. the tenant returns) is the existing `reactivateMember` path on the
Settings page's Members table; there is currently no single "reactivate
the whole organization" action, since re-onboarding an org is expected to
involve a real conversation about current state, not a one-click undo of
offboarding.

## Retention after offboarding

How long an offboarded tenant's data stays in FigBloom's database at all
(as opposed to just being access-revoked) is a contractual/legal question
this codebase does not decide on its own -- **it must be agreed as part of
the pilot or subscription terms**, per FIG-444 §12. Nothing in this repo
currently enforces an automatic deletion schedule after offboarding; if
one is ever agreed, it would need its own scheduled job (following the
`scripts/notifications-sweep.ts` cross-organization pattern) and its own
decision about whether that means hard-deleting every row or something
softer -- building that is explicitly out of scope here, not an oversight.

## Why this is CLI-only, not a Settings-page button

Same reasoning as `docs/DATA_DELETION_REQUESTS.md`'s erasure script:
offboarding an entire organization is rare, high-stakes, and usually tied
to a real external decision (a contract ending, a pilot concluding) that
should be confirmed by a person with server access, not something any
Management user could trigger by clicking the wrong thing. FIG-444 §13
explicitly defers self-service "advanced tenant administration" as a
later concern, not part of this V1.
