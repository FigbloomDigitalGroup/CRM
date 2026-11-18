# Settings backend, integrations, audit log and reference data (FIG-1058, FIG-1060, FIG-799, FIG-1063)

## Settings and website key (B4.01)

- `GET /settings/overview`: organisation profile, members by state (invited, active, deactivated, removed), integration states. `GET /memberships` now carries each person's `lastSignInAt`.
- **Website key rotation** (`POST /integrations/website-key`, optional `{ graceHours }`, default 24, 0 to 72): the new key works at once and the old one keeps working until the window ends, so the live form never breaks.
  Only one previous key is kept; revoking stops both. The status shows when it was rotated, the old key's prefix and end, the last accepted and last rejected submission, and the last rejection with an explanation.
- `GET /integrations/website-key/rejected`: submissions turned away (rate limit, wrong key, origin, too large, invalid, honeypot, captcha), each with the reason in plain words. Management only.
- Inbound email status: when mail last arrived and the last message that could not be processed (cleared by the next good one).

## Integrations registry (B4.03)

`GET /integrations` lists the website form, inbound email, WhatsApp click-to-chat, and the planned ones (email provider V1.1, calendar V1.1, API and webhooks V2, accounting), each **Connected**, **Not connected** or
**Planned**, derived from real signals: the website is connected once a submission was actually accepted, inbound email once mail actually arrived, WhatsApp once a number is set (click-to-chat has no event to watch; its activity is
the WhatsApp calls people log). `PUT /integrations/whatsapp` sets the organisation number (any local form, stored as digits with country code) and the message templates; the quick-log prompt returns a ready `wa.me` link with the message filled in.

## Audit log (FIG-799)

`GET /audit/events`: every audit event for the organisation, newest first, filtered by actor, entity type, action (`membership.*` for a prefix) and dates, paged. Each row names the actor and the record and links to it
(`link.path`); a record that was deleted or archived still renders, named from what the event recorded. `GET /audit/filters` feeds the filter controls, `GET /audit/events/export` is the CSV (and is itself audited).
Needs `audit.view` (Management). Payment entities are left out for a reader without `finance.view.payments` (asking for one by name is refused, not answered with an empty page), and money in deal and service snapshots is
blanked without `deals.view.value`. Exports, imports, member and role changes and key rotations were already audited.

## Reference data admin (B4.06)

One service over lead sources, lead statuses, pipeline stages, lost reasons, services, lifecycle states, tags, email templates and custom field definitions (`/reference-admin/{kind}`): create, rename, reorder, hide, usage count, delete, merge.

- **Hide, don't delete, what is in use.** A hidden value leaves the pickers and stays on records that carry it. Deleting an unused value works; a used one is refused with the usage ("in use (3 leads and 2 deals)") and the advice to hide it.
- **Merge** re-points every reference (including website assignment rules, qualification questions and lifecycle history) and removes the merged value, audited with what moved.
- **Some values are the system's.** Pipeline stages are fixed in V1 (rename only). The lifecycle states the engine drives, the NEW status and the WEBSITE source can be renamed but never hidden, deleted or merged away.
- A hidden tag cannot be added to a record. Permissions follow the list: `configuration.manage`, `tags.manage`, `templates.manage`, `customfields.manage`.
