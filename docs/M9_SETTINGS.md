# Settings (M9, Frontend 4: FIG-1106 to FIG-1111)

Issues: F4.04 (FIG-1106) core settings, F4.05 (FIG-1107) audit log, F4.06 (FIG-1108) automations and integrations, F4.07 (FIG-1109) templates, tags and custom fields, F4.08 (FIG-1110) data migration wizard, F4.09 (FIG-1111) security and access, data and privacy. Design: `design-spec/CrmSystem.dc.html` (the Settings frame and sections), `CrmSettingsPlus.dc.html` (templates, tags, fields), Screen Checklist rows S1, S2, S5 to S9, S5#2 and AP9. Code: `src/ui/screens/settings/`; the route is `/o/{org}/settings?tab=<section>`.

## How it is put together

- `src/app/o/[orgSlug]/settings/page.tsx` is a thin server page. It resolves the member, records the page view, and hands the screen the **role matrix** (built from the seed, only for a reader with `configuration.manage`).
- `SettingsScreen.tsx` is the frame the design draws: a left list of sections and the chosen one beside it (`?tab=`; an unknown tab opens Organization profile; on a phone the list becomes a scrolling row). **Only Management reaches Settings.** Anyone else gets the explained no-access card (`NoAccess`, their role, who has access, who to ask) and a link to Preferences, where their own look, notifications and sign-in history live. The card is also what any section shows if the API refuses it (`Gate`). Hiding the list is not the boundary: every route behind it checks `configuration.manage` / `audit.view` / `membership.manage` itself, and `e2e/settings-admin.spec.ts` asserts the 403s.
- Everything reads and writes through `useApiQuery` / `useApiMutation` / `useApi` against the frozen API; no screen calls `fetch` (`tests/uiGuards.test.ts` is green; the `.eslintrc.json` exclusion list did not grow). The pre-redesign forms beside the page (`CatalogEditor`, `MembersTable`, `InviteMemberForm`, the website and inbound key buttons, `OrganizationProfileForm`, `NotificationPreferencesForm`, `WebsiteLeadAssignmentRulesEditor`, `WebsiteSecuritySettingsForm` and the toggles) are **no longer rendered by anything**. They are left in place because deleting files needs Given; they, their `.eslintrc.json` entries and `tests/components/CatalogEditor.test.tsx` can go together.
- `kit.tsx` holds the pieces every section uses: `Panel` (the section card), `Switch` (a real `role="switch"`), `Gate` (loading, then the error or explained no-access, then the content), `useReport` (success and failure toasts; a failure shows the API's own message for validation and conflict and the generic one otherwise), and `useWhen` (dates in the member's time zone and clock).
- Styles: `settings.css`, every selector starts with `.fb-set`. Colours come from the theme tokens, so every theme, page colour, dark mode, compact density and the Largest text size apply.

## The sections

| Section (`tab`) | Screen | What it does |
|---|---|---|
| Organization profile (`org`) | `OrganisationProfile.tsx` | Name, phone, website, address, time zone, working days and hours (`/profile`). Logo upload (PNG, JPG or WebP up to 2 MB, checked before sending), display name, **default theme for new members** and **allow members to personalise** (`/look`). Turning personalisation off makes everyone use the shared look; text size, density and accessibility always stay personal. |
| Members (`members`) | `Members.tsx` | Invite (name, email, role), role change, and the four states of B1.12 (Invited with an "expired" flag, Active, Deactivated, Removed) with the actions each allows: resend, cancel invite, deactivate, reactivate, unlock, remove. You cannot act on yourself. Deactivate keeps records and lists open work afterwards; remove is refused while the person owns open records and the dialog lists them and **hands them over** (`/reassign`) before removing. |
| Website integration (`website`) | `Website.tsx` | Key prefix and state (Connected only once a lead was actually accepted), **rotate with a grace window** (0 to 72 hours; the new key is shown once in a dialog), revoke, allowed websites, honeypot, challenge secret (write-only), acknowledgement switch, assignment mode and rules (order, pause, add), recent submissions with the plain-words reason for each rejection. |
| Inbound email (`email`) | `Website.tsx` | Create, regenerate (new key shown once) and revoke; when mail last arrived and the last message that could not be processed. |
| Reference data (`ref`) | `ReferenceData.tsx` | One generic manager over `/reference-admin/{kind}` for lead sources, lead statuses, pipeline stages, lost reasons, services and customer lifecycle: add, rename, reorder (up and down buttons), **hide (not delete) what is in use**, delete what is not, merge. A value the system relies on says "Used by the system" and has no hide, delete or merge. Pipeline stages are rename-only in V1 and the list says so. |
| Customer lifecycle (`lifecycle`) | `Lifecycle.tsx` | Due-soon and grace days for renewals, and the reminder switches (proposal follow-up days, renewals, going quiet, overdue invoices). Reminders create tasks and notices; they never move a customer. |
| Onboarding template (`template`) | `Lifecycle.tsx` | The tasks offered in the handoff dialog when a deal is won, the lifecycle state after handoff, and whether Management can mark a handoff delivered (`/handoff-settings`). |
| Automations (`automations`) | `Automations.tsx` | Every rule with a switch, its trigger, what it did in the last seven days, and (under "Settings") its numbers and who is told; read-only numbers say where they are changed. The boundary sentence comes from the API (`boundary`): automations assign, remind and draft; they never move a deal stage, set a discount, approve anything or change an owner outside an assignment rule. Run log below, filterable by rule and outcome. |
| Integrations (`integrations`) | `Integrations.tsx` | The registry: Connected, Not connected or Planned from real signals, the reason, last activity and last problem. Website and inbound email link to their sections; **WhatsApp click-to-chat** is configured here (number, default message, up to 20 templates); planned ones are disabled and say so. |
| Message templates (`templates`) | `Managers.tsx` | Two panes: the list, and the editor with merge-field chips and a live preview filled with a sample person. Hide, not delete. |
| Tags (`tags`) | `Managers.tsx` | Reference list over `tags` with coloured pills and a colour editor; hidden tags leave the pickers and stay on records; merge moves records. |
| Custom fields (`fields`) | `Managers.tsx` | Table of fields with type, scope, service and "required"; new and edit dialog (type, choices, help, qualification question, required to qualify); hide keeps the field on old records. Required fields are enforced only when a lead is qualified, never at quick capture. |
| Data migration (`migration`) | `Migration.tsx` | See below. |
| Security & access (`security`) | `Security.tsx` | Session lifetime policy (applies to new sessions, audited), the fixed lockout and password rules stated plainly, every member's sign-in events with failures marked and an outcome filter, "How access ends", and the **read-only role matrix**. |
| Data & privacy (`privacy`) | `Privacy.tsx` | Export rights (roles, approval threshold, approval window), retention per data type (empty keeps), legal hold (needs a reason), and data-subject requests with deadlines, overdue marked, log, prepare data, two-person deletion confirmation, decline with a reason. |
| Audit log (`audit`) | `AuditLog.tsx` | Filters (person, record type, action, dates), 25 per page, detail drawer with before and after, record links (a deleted or archived record still renders), CSV export of what the filters show. Read-only. |

### Data migration wizard (S7)

Seven steps, as the API defines them (`SOURCE, UPLOAD, MAP, VALIDATE, DRY_RUN, IMPORT, REVIEW`), shown as a stepper that follows the session. The session lives on the server, so leaving and coming back resumes at the same step (the "Earlier migrations" list).

1. **Source**: what to bring in (companies, contacts, leads, deals, tasks, activities), our template or another spreadsheet, and the duplicate policy; deals add "create companies that do not exist yet" (FIG-800).
2. **Upload**: `.csv` or `.xlsx` up to 20 MB (wrong type and size are refused before sending); the template downloads from here. A file imported before warns.
3. **Map**: each CRM field to a column; required fields marked and the button says what is still unmapped; the mapping can be saved as a preset.
4. **Validate**: counts, the first problem rows (with a downloadable error report beside their original values), and the **values the CRM does not know** with a chooser for each; nothing is guessed. Continue is disabled when no row is usable.
5. **Dry run**: exactly what the import would add, update and skip, duplicates, new companies, contacts and tags, and a sample. Writes nothing.
6. **Import**: needs the dry run and an explicit tick; progress is polled from the session; cancel is available until it finishes.
7. **Report**: added, updated, skipped, failed; the error report; **rollback** within its window (the dialog says what is kept: records edited since, and records other records now depend on) and, afterwards, what the rollback removed, restored and kept.

## Decisions taken without being asked (tell me to change any)

1. **Non-Management gets the explained no-access, not a notifications tab.** The design's Settings shows non-Management members a "Notification preferences" tab; that content moved to Preferences (F4.03) and FIG-1106 says only Management reaches Settings.
2. **The website key is shown once.** The design has Reveal and Copy on the key; the API stores only a hash, so a key can only be shown when it is made. Afterwards the page shows the prefix.
3. **Abuse protection shows what the API really has** (allowed websites, honeypot field name, challenge secret) instead of the design's four checkboxes; rate limit and the duplicate check are always on and say so.
4. **Lockout and password length are stated, not editable.** The design has a lockout checkbox and a passwords checkbox; the API has only the session lifetime (`/security/session-policy`). Lockout (5 wrong passwords, 15 minutes) and the 10-character minimum are fixed in V1 and shown as a fact.
5. **Custom fields have no per-role visibility switch.** FIG-1109 asks for "visibility per role"; the API has no such field (a field is shown to whoever may see the record). The column and control are not invented; this needs a backend decision if wanted (suggest V2's field-access editor, B7.06).
6. **Reordering uses up and down buttons**, not drag only, so it works by keyboard and screen reader (the design's grip is decorative).
7. **The Customer Support role is not offered** in the invite or role lists (proposed and behind a flag); a person who already has it keeps it.
8. **The audit log shows the API's masked values as they come** (blank money for a role without `deals.view.value`, no payment records without payments access); the screen does no masking of its own.
9. **Sections that belong to V1.1 and V2** (catalogue, pipelines and stage rules, sequences, web forms, approval rules, email and calendar, AI assistant, two-step sign-in, roles and field access, developers, data requests, support access history) are not in the list; they arrive with their releases.

## Known gaps

- The audit "Record type" filter lists the technical names the API returns (`Membership`, `Deal`), prettified; friendlier names need a label map from the backend.
- The privacy overview's export-approval queue is counted ("2 exports are waiting") but approving or declining is not on this screen; it is done where the export was requested (B4.05) and in V1.1's approvals inbox.
- Reassignment after deactivating hands over everything to one person; choosing per record kind is possible in the API (`kinds`) but not offered.

## Tests

- Component tests in `tests/components/screens/settings/` (`npx vitest run --config vitest.settings-components.config.ts`, which skips the database set-up): frame and no-access, members, reference data, tags, templates, custom fields, audit log, automations, integrations, organisation profile and look, website and inbound key, lifecycle and handoff template, security, role matrix (snapshot of the approved matrix), privacy and the whole migration wizard with stubbed API states. Most also run axe.
- Playwright: `e2e/settings.spec.ts` (rewritten for the redesigned page; same flows: invite, role, cancel invite, reference list), `e2e/settings-admin.spec.ts` (profile and lock, website key, audit filters and export, automations, integrations, tags, templates and fields, security policy, privacy, and the refusal for Sales, Delivery and Finance), `e2e/settings-migration.spec.ts` (the wizard against fixture files with bad rows, dry run, import, error report, rollback). `e2e/website-capture.spec.ts` and `e2e/restricted-technical.spec.ts` were updated to the new controls.
