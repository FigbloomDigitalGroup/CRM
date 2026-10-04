# Data deletion requests (GDPR / Kenya DPA)

How to handle a "please delete my data" request -- whether it arrives
citing GDPR (if the person is in the EU/UK) or Kenya's Data Protection
Act, 2019 (DPA). This document is the process; `scripts/erase-data-subject.ts`
is the one step of it this codebase actually executes.

## Who this applies to

A **Contact** -- a natural person -- is the data subject these laws
protect. A **Company** is a business entity, not personal data, so a
request "delete everything about Acme Ltd" is not a DPA/GDPR erasure
request at all (though it might still be a legitimate business reason to
archive the company -- see "Archiving vs. erasure," below). The one
genuine edge case is a sole trader recorded as a Company: if the request
is plausibly about an individual rather than a business, treat it as a
Contact-shaped request and handle the sole trader's own Contact record
(create one first if the org never created one) -- do not attempt to
erase the Company row itself (see "Why Company is out of scope," below).

## Step 1: Verify the request is genuine

Before touching anything:

1. Confirm the requester is who they claim to be, or is legally
   authorized to act for that person (a response to the email/phone
   number already on file is reasonable; a request from an unverified
   new address is not).
2. Confirm which organization(s) in this system might hold their data --
   a request should name the organization (e.g. "FigBloom") or you should
   be able to infer it from how they contacted you.
3. Log the request itself somewhere outside this codebase (a ticket, an
   email thread) with the date received -- both laws have response-time
   expectations (GDPR: one month, extendable once; Kenya DPA: without
   undue delay), and that clock starts at receipt, not at execution.

## Step 2: Decide what "erasure" actually requires here

Neither law requires destroying data this organization has a separate,
valid legal basis to keep. In this CRM, that mainly means:

- **Financial/deal records** (`Deal`, and anything referencing it) often
  need to be retained for tax/accounting obligations independent of the
  erasure request. This is also enforced at the database level: a
  `Company` cannot be deleted while it still has any `Deal`
  (`Deal.companyId` is required, `ON DELETE RESTRICT`) -- which is exactly
  why Company erasure isn't supported at all (see below). A Contact's own
  `Deal.primaryContactId` link is `ON DELETE SET NULL`, so erasing a
  Contact never blocks on this; the Deal itself survives, just loses the
  link to that person.
- **Audit records** (`AuditEvent`) are deliberately append-only at the
  database level (the application role has `UPDATE`/`DELETE` revoked on
  that table -- see `prisma/migrations/*_tenant_integrity_and_rls`) and
  are themselves often a *compliance* record this organization needs to
  retain (who did what, when). `scripts/erase-data-subject.ts` records
  one more audit event -- `data_subject.erased` -- *before* deleting the
  Contact, specifically so there's a durable record that the request was
  honored, even though the Contact row it refers to is gone afterward.

What genuinely gets deleted: the Contact row itself, and every Activity,
Task, and Communication directly linked to it (these `ON DELETE CASCADE`
from Contact -- see the model in `prisma/schema.prisma`). Any Lead/Deal
that referenced this contact keeps existing (it's the organization's own
business record), just with the contact link cleared.

**What this does not do:** scrub the person's name out of free-text
fields on *other* records -- a Lead's or Deal's `notes` field might still
mention them by name. Automatically and reliably redacting unstructured
text is not something to attempt with a script; if the request is strict
about this, it requires a human to search `notes` fields for the name and
redact by hand. Say so to the requester rather than claiming a
completeness the system can't actually guarantee.

## Step 3: Run the script

```bash
# Dry run first -- always. Prints exactly what would be deleted/unlinked,
# deletes nothing.
npx tsx scripts/erase-data-subject.ts --org <slug> --contact <contact-id>

# Only once the dry-run output looks right:
npx tsx scripts/erase-data-subject.ts --org <slug> --contact <contact-id> --confirm
```

This is deliberately a command someone with direct server/database access
runs by hand -- there is no "Erase" button anywhere in the product, and
no API route for it. An erasure request is rare, high-stakes, and
requires the human judgment of Steps 1-2 first; a self-service UI would
make it too easy to skip straight past that judgment.

## Step 4: Confirm back to the requester

State plainly what was deleted (Contact record, and its Activities/Tasks/
Communications) and what was retained and why (any Lead/Deal that
referenced them, for financial/legal record-keeping; the audit trail,
which is append-only and itself a compliance record). Both laws expect
you to be able to explain retention, not just silently keep data.

## Archiving vs. erasure

FIG-601's archive/restore feature (`companies.archive`/`contacts.archive`/
etc.) is a completely different thing from this document: archiving only
sets `archivedAt` and hides a record from default lists -- nothing is
removed, nothing is unlinked, and it's fully reversible. It's the right
tool for "we no longer work with this company" or "this lead went cold."
It is **not** a response to an erasure request -- an archived Contact's
data is still fully present in the database.

## Why Company is out of scope

A Company is a business entity, not a GDPR/DPA data subject, so there is
deliberately no `erase-data-subject.ts --company` option. If this ever
needs to change (e.g. a jurisdiction that extends similar rights to sole
traders as a matter of course, not case-by-case), building it would also
require deciding what to do about any Deal still pointing at that Company
(`ON DELETE RESTRICT` means the database will refuse the delete outright
until every such Deal is reassigned elsewhere or deliberately removed
first) -- not a mechanical extension of the Contact path.
