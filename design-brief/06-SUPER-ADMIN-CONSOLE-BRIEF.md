# Claude Design brief, third pass: Platform Super Admin console

Paste into the **same Claude Design project**. Do not restart. The first and second passes stay as they are.

## 0. Decisions already made (do not redesign)

- **Management is the organisation admin.** There is no separate Organisation Admin role. Everything admin in the organisation (members, roles, settings, integrations, reference data, security, data and privacy, audit log) stays with Management, as in the current prototype.
- **Sign-in and sign-up pages are frozen.** The only change allowed there is **one extra tap-to-sign-in chip** (section 3) and a **separate** two-step screen shown after sign-in (section 3).
- **Keep** the colour tokens, the design system, the review bar, the release tag and the "Show: V1 / + V1.1 / + V2" switch.
- **Billing, white-labelling, self-service tenant sign-up and a customer portal stay out of scope** (FIG-436 deferrals).

## 1. Who the Platform Super Admin is

The people who **operate Figbloom CRM as a product** (today: Given and Michael). They are **not a member of any organisation** and hold **no tenant role**. They have a separate identity of type "platform", a separate area of the app, and by default **no access to any organisation's business data** (leads, deals, values, customer details). They run organisations, they don't work in them.

They exist because FIG-436 says platform administration is separate from ordinary organisation users, and FIG-437 leaves the platform-admin mechanism open. Today this is a command-line script. This brief designs the console that replaces it.

## 2. Principles

1. **Least access by default.** The console shows health, counts and configuration, not customer records.
2. **Break-glass for anything more.** Seeing inside an organisation needs a reason, a time limit, the organisation admin's visibility, and a visible banner.
3. **Everything is audited**, in a platform audit log the platform admins themselves cannot edit.
4. **Dangerous actions are slow on purpose.** Suspend, offboard and delete need a typed confirmation, and deletion needs a second platform admin to approve (two-person rule).
5. **Never confusable with an organisation.** A different shell, banner and accent so nobody acts on the wrong level.
6. **Calm and small.** A handful of organisations today. Do not design an enterprise billing portal.

## 3. Sign-in integration

1. **Add a chip "Dev Super Admin" to the existing "DEV ACCOUNTS · LOCAL ONLY" row** on the sign-in screen, styled like the others, so one tap signs in. Also add "Super Admin · Platform" to the review bar's **Account** list.
2. Tapping it lands on **Platform home** (P1), not an organisation.
3. Real sign-in for platform admins: after the normal email and password, a **separate "Verify it's you" screen** (authenticator code, backup code, device trust is **not** offered for platform admins). The dev chip skips it and shows a small orange **"Dev only: verification skipped"** strip on Platform home. Propose this screen as **new**; do not alter the frozen sign-in page itself.
4. A normal organisation user who types the platform address sees a plain **"Page not found"**, not an explained access page, so the console's existence is not advertised.
5. Add **"Dev Customer Support"** to the dev chips and the review-bar accounts too, as the proposed sixth organisation role from the second-pass brief (tagged "proposed"), so reviewers can tap into it.

## 4. Platform shell

- Left rail, narrower than the organisation sidebar: Home, Organisations, Data requests, Support access, Health, Audit log, Platform admins, Security, and (V2) Flags and limits, Announcements.
- Top bar: a persistent **"Platform console"** pill and a distinct accent so it is visibly a different level; global search is **organisation names only**; user menu with "Sign out". No notification bell for business events.
- **Theme and mobile:** light and dark; desktop first. Mobile (375px) only for **Home, Health and approvals** (a platform admin on a phone must be able to see an incident and approve a request).
- No quick-create "+" and no deal or lead language anywhere.

## 5. Screens (IDs continue the checklist as PL1, PL2, …)

| ID | Screen | Release | Notes |
|---|---|---|---|
| PL1 | **Platform home** | V1.1 | Tiles: organisations (active, suspended, offboarding), active users in 7 days, failed scheduled jobs, failed website leads in 24 hours, error rate, last backup status, pending requests (data requests, support access approvals). "Needs attention" list at the top, then trends. States: all healthy, degraded (what and where), loading, error. |
| PL2 | **Organisations list** | V1.1 | Name, slug, status chip (Active, Suspended, Offboarding), members, last activity, created, plan or flag summary (V2), adoption indicator from page usage. Search, status filter, sort, "Provision organisation". States: first-run (one organisation, FigBloom), empty search, loading, error. |
| PL3 | **Provision organisation wizard** | V1.1 | Steps: name and slug (slug availability check), time zone, default currency, first admin (email, they get a Management role invite), **defaults preview** (lead sources, lead statuses, pipeline stages, lost reasons, services, customer lifecycle states, each editable before creating), website key and inbound email key (create now or later), review, create. Success screen with invite status and a copyable link. Errors: slug taken, email already invited, seeding failed (retry, nothing half-created). |
| PL4 | **Organisation detail** | V1.1 | Overview (status, created, owner contact, time zone, currency), **members summary** (counts by role, names and emails only, no business data), **integrations health** (website key last used, last accepted and rejected submissions, inbound email last received, errors), **usage** (page views, active users, data volume), **jobs** (notification sweep last runs), recent audit slice, **actions menu**: Resend admin invite, Suspend, Reactivate, Request support access, Export data, Start offboarding. Banner when suspended or offboarding. |
| PL5 | **Suspend and reactivate dialogs** | V1.1 | Reason (required), what happens (sessions end, sign-in blocked, data kept, public website endpoint behaviour), notify the organisation's admin (default on), typed confirmation of the organisation name. |
| PL6 | **Offboarding and data requests** | V1.1 | Queue of tenant offboarding and data-subject deletion requests (FIG-444, `TENANT_OFFBOARDING`, `DATA_DELETION_REQUESTS`): requester, organisation, type, status (Received, In review, Approved, Completed, Rejected), due date, evidence notes. Detail: checklist of steps, export of the organisation's data with download and expiry, retention countdown, **second-admin approval** for deletion, completion certificate. States: nothing waiting, overdue request, approval pending from the other admin. |
| PL7 | **Support access (break-glass)** | V2 | Request form: organisation, reason, ticket reference, scope (read-only view of settings and health, or a specific record type), duration (30, 60 or 120 minutes), mask customer values by default. Status: Pending organisation approval, Approved, Active (countdown), Ended, Denied, Expired. The organisation's Management user gets an approval card (see section 6). Active session shows a persistent orange **"Support view, read-only, ends in 42:10"** bar with an End button. Every page viewed is logged. |
| PL8 | **Platform audit log** | V1.1 | Who, organisation, action, target, time, IP and device. Filters by admin, organisation, action type, date. Export. "Cannot be edited" notice. Includes support-access views, provisioning, suspensions, flag changes and admin changes. |
| PL9 | **System health** | V1.1 | Scheduled jobs and last runs (notification sweep), website lead request failures across organisations, email delivery failures, rate-limit and lockout events, error tracking summary with a link out, database and backup status, migration and app version. Per-component status (Healthy, Degraded, Down) with timeline and "what to do" hints. |
| PL10 | **Platform admins** | V1.1 | List (name, email, 2FA status, last sign-in, added by), invite, remove, require **at least two** admins (warn and block removing the last two), recovery and lost-device flow. |
| PL11 | **Platform security** | V1.1 | Verification required (locked on), session length (short), optional IP allowlist, alert on new device sign-in, failed-sign-in alerts. |
| PL12 | **Flags and limits** | V2 | Per organisation toggles (assistant on or off, integrations enabled, import size limit, seat limit). **No prices, no billing.** Show change history. |
| PL13 | **Announcements** | V2 | Compose a banner shown to chosen organisations (maintenance, new feature), schedule, preview how it looks in the organisation shell, expire. |
| PL14 | **Verify it's you (second step)** | V1.1 | Authenticator code, backup code, attempts left, lockout message, "dev only: skipped" variant. |
| PL15 | **Not found page for non-platform users** | V1.1 | Plain, generic. |

## 6. Organisation-side screens this creates (design these in the organisation shell too)

| ID | Screen | Release | Notes |
|---|---|---|---|
| OS1 | **Suspended organisation screen** | V1.1 | What a member sees when the organisation is suspended: plain explanation, who to contact, no data shown. |
| OS2 | **Support access approval card** | V2 | Management sees a request from Figbloom Support: reason, scope, duration, **Approve, Deny**, and an expiry. Also in Notifications. |
| OS3 | **Support access banner** | V2 | When a support view is active inside the organisation, every user sees "Figbloom Support is viewing settings (read-only) until 15:40". |
| OS4 | **Settings › Security › Support access history** | V2 | Management-only table of past and active support sessions: who, why, when, pages viewed, ended by. |
| OS5 | **Maintenance and announcement banner** | V2 | Dismissible banner from PL13. |
| OS6 | **Data requests (organisation side)** | V1.1 | Management can file an export or deletion request and see its status (links to PL6). |

## 7. Permissions (provisional, for Michael)

Platform permission keys, separate from tenant permissions and **never granted through an organisation membership**: `platform.orgs.view`, `platform.orgs.provision`, `platform.orgs.suspend`, `platform.data_requests.manage`, `platform.data_requests.approve` (a second admin), `platform.support.request`, `platform.audit.view`, `platform.health.view`, `platform.admins.manage`, `platform.security.manage`, `platform.flags.manage`, `platform.announcements.manage`. Show these in the role matrix as a **separate "Platform" block**, flagged provisional. Platform admins have **none** of the tenant permissions (no `leads.view.all`, no `deals.view.value`).

For engineers, annotate the screens: platform actions run under a **separate service identity**, not the tenant application role, so organisation isolation (row-level security and organisation scoping) is not weakened.

## 8. Roles check: what else could be missing (design nothing new, answer in "Open questions")

Add these as questions in the checklist, not as screens:
1. **Sales Lead** with team-scoped visibility between Sales and Management (relevant once the sales team grows beyond two or three).
2. **Read-only Viewer or Auditor** (for example an investor or a quality reviewer).
3. **Non-human identities** (website form, API tokens, automations) shown in the audit log as named "service" actors rather than a person.
4. Whether **Marketing** and **Business Development** (left unticked in the questionnaire) ever become distinct people.
5. **Customer Support** (proposed sixth role): confirm in or out.

## 9. Deliverables

1. Prototype: sign-in chips for Dev Super Admin and Dev Customer Support, Platform console screens PL1 to PL15 and organisation-side screens OS1 to OS6, light and dark, desktop and the three mobile screens, release tags and the V1 / + V1.1 / + V2 switch applied.
2. Updated **Screen Checklist** rows for every ID above, with role cells (a new "PLATFORM" column and the existing five plus Customer Support) and a Linear column ("new").
3. Updated **role matrix** with the Platform block and the proposed Customer Support role.
4. Any new components added to the design system page (status chips, break-glass banner, countdown, typed-confirmation dialog, approval card).
5. Open questions and assumptions, especially: the two-person deletion rule, support-access approval by the organisation (required or optional), and anything touching a documented deferral.
