# Data and privacy (FIG-1062, B4.05)

Settings > Data and privacy (S9, OS6): control and evidence for data protection (Kenya DPA). Management only (`security.manage`). Every change and every request step is audited,
and the audit rows hold ids and counts, never a person's details.

## Export rights

An export above the **row threshold** (default 500) needs the bulk-export permission (Management), a role the organisation has allowed (`allowedRoleKeys`), or an **approval**:
the person asks (`POST /privacy/export-approvals`), a different Management member approves, and the export starts with the `approvalId`. An approval is for one person, one kind of export
and one use, is for at most the size it was asked about, and expires (default 72 hours). Today only Management holds an export permission, so approvals matter once the role editor (V2) grants it elsewhere.

## Retention

A period per kind of data, with a documented default, edited at `PUT /privacy/retention` (a number, `null` to keep, `"DEFAULT"` to reset). The daily `privacy.retention` job purges what is older.

| Data | Default | Range |
|---|---|---|
| Sign-in history | 24 months | 3 to 120 months |
| Uploaded import files | 90 days | 7 days to 10 years |
| Generated export files | 30 days | 1 day to 10 years |
| Offline sync history | 90 days | 7 days to 10 years |
| Automation run log | 365 days | 30 days to 10 years |
| Archived leads | kept | 12 to 240 months |
| Archived tasks | kept | 6 to 240 months |

Contacts, companies, deals, invoices and payments are never purged by retention: they are removed only by an erasure request (a contact) or by the platform when an organisation is deleted.
The audit log is not purged. A file used by a running migration is left alone. Each purge is audited with its counts; a repeat run purges nothing and audits nothing.

**Legal hold** (`PUT /privacy/legal-hold`, with a reason): while on, the retention job does nothing at all and nobody can be erased. Placing and releasing it are audited.

## Data-subject requests

`POST /privacy/requests` files an ACCESS, RECTIFICATION or ERASURE request for a contact, due in 30 days by default, with evidence notes (timestamped, append-only). Statuses: OPEN, IN_PROGRESS,
AWAITING_SECOND_CONFIRMATION, COMPLETED, REJECTED. The list flags overdue ones.

- **Access** (`fulfil-access`): one CSV of everything held about the person (record type, id, field, value), with a short-lived download link; deal values follow the caller's permission.
- **Rectification** (`rectify`): the corrections go through the normal contact update (audited on the contact); the request records the field names, not the values.
- **Erasure** (`confirm-erasure`): **two different Management members** confirm; the first parks the request, the second erases. Until the approvals engine (B6.13) this is the second confirmation.

### What erasure does

Goes: the contact and every contact merged into it, their activities, tasks, conversations, comments, tags and custom fields, attached files (the stored bytes too), unlinked conversations from their
address or number, notifications and recent searches that name them, and the personal data in the audit and merge snapshots about them (the rows stay; their content becomes `{"erased": true}`).
Stays: leads and deals that referred to them (unlinked), invoices and payments, aggregate counts. The proof is an audit event `data_subject.erased` with counts and a salted hash of the email and phone.
**For a person to review:** free text elsewhere that mentions them (a lead's notes, a task's description). The result counts those records. The command-line script `scripts/erase-data-subject.ts` runs the same service.

## Organisation-level requests

`POST /privacy/organisation-requests` records a request to export or delete the whole organisation and audits it; the platform team carries it out with two-person approval (B6.09, V1.1).
Nothing is exported or deleted by the call.
