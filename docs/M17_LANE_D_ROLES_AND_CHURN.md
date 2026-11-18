# M17 lane D: roles and field access editor (FIG-1188, B7.06) and churn hints (FIG-1190, B7.08)

Both are V2 (`release.v2`). An organisation below V2 answers every route here with 403 `FEATURE_UNAVAILABLE` before anything else.

## 1. Roles and field access editor (FIG-1188)

Management (new permission `roles.manage`, V2, Management only) creates **custom roles** for its own organisation, edits their permissions inside the platform's limits, sets field visibility, and previews the effect before saving. The five platform roles are read-only here and behave exactly as before.

| Piece | Where |
|---|---|
| Limits (reserved keys, view-before-change rules, field catalogue) | `src/lib/roleLimits.ts` (pure) |
| Service: list, get, catalogue, create, update, archive, preview | `src/services/roleEditorService.ts` |
| Routes | `src/app/api/orgs/[orgSlug]/roles/` (`route.ts`, `catalog`, `preview`, `[roleId]`) |
| Tables | migration `20261124090000_custom_roles`: `roles` gains `organization_id`, `based_on_role_key`, `archived_at`, `created_by_membership_id`; new `role_field_rules` |
| Assignment check | `src/repositories/roles.ts` (`findAssignableRole`), used by invite and change-role in `membershipService` |
| OpenAPI | `src/api/v2OperationsD.ts` (`V2_OPERATIONS_D`, to be spread in `src/api/openapi.ts`) |
| Tests | `tests/roleEditor.test.ts`, `tests/roleMatrixLive.test.ts` |

### How it fits the permission model

A custom role is a row of `roles` that belongs to one organisation, with its keys in the existing `role_permissions`. So every existing permission check (`requirePermission`, `resolveScope`, the masking helpers) works on it unchanged, because they only ever read permission keys. `resolveActiveMembership` reads the role afresh on every request: **a change is effective on the next request** (no cache sits in front of it). The one cache nearby, the shell's `/me/context`, is cleared for the whole organisation on every role write.

Row-level security: `roles` and `role_permissions` show the platform roles to everyone and a custom role to its own organisation only; `role_field_rules` is an ordinary tenant table with a composite foreign key to the role. A custom role belonging to another organisation is "unknown" to invite and change-role (`findAssignableRole`), not an error that confirms it exists.

### Platform-defined limits

- **Reserved keys are never granted to a custom role.** Running the organisation (`organization.manage_settings`, `membership.manage`, `role.assign`, `roles.manage`, `configuration.manage`, `security.manage`, `audit.view`, `export.bulk`, `api_tokens.manage`, `webhooks.manage`, `ai.configure`) stays with Management. Payments (`finance.view.payments`, `finance.manage.payments`, `payments.manage`) stay with Finance and Management (hard rule 7), and `deals.margin` with Management.
- A change right needs the matching view right (for example `leads.edit.all` needs a `leads.view.*`); the refusal says which key to add.
- At most 25 live custom roles per organisation; names are unique per organisation (any capitals) and cannot equal a platform role's name.
- A seeded departure that is switched off for the organisation (`departure.*`) removes its keys from custom roles too.

### Field access

`deal.value` is the editable field: **all** (adds `deals.view.value`), **own** (the deal's owner only, the Sales default) or **hidden** (not even the owner). The field rule is the authority for its key. Hidden travels on the request context as `hiddenFields` and is read by `canSeeDealValue` and by the four places that applied an owner exception on their own (quote versions, the deals summary, the salesperson report, the deal board), so a hidden value is hidden on every path. `deal.margin` and `payments` are fixed to hidden for custom roles (a rule that tries to open them is refused). Further fields (for example contact phone) need a masking surface first; add them to `FIELD_CATALOGUE` when that exists.

### Safeguards

- **Last Management cannot be locked out, by construction:** no custom role can carry a key that runs the organisation, so no edit here can reduce what Management can do; `membershipService` still refuses to move or remove the last active Management member (tested with a custom role as the target).
- Archiving a role refuses while any person holds it (`ROLE_IN_USE`); an archived role grants nothing even if a membership still points at it.
- Platform roles cannot be edited or archived (`PLATFORM_ROLE_FIXED`).
- Every create, update and archive is audited (`role.created`, `role.updated` with before and after keys and rules and the number of people affected, `role.archived`).

### Preview

`POST /roles/preview` answers a proposal exactly as saving would (including every refusal) and adds: keys gained and lost, per screen family (leads, deals, tasks, companies, contacts, proposals) what the role could see and change with whether it changed, the field rules before and after, the people it would reach, and warnings. It writes nothing.

### Extended authorization matrix

`tests/roleMatrixLive.test.ts` builds the matrix **from the roles the database holds**: it lists the platform and custom roles through the editor, gives each a member, and calls seven real route handlers as each (list roles, catalogue, preview, leads, deals, audit, invoices). What each role may do is derived independently from its own permission keys; the route must answer 403 exactly when none of the needed keys is held, with an explained denial, never a 5xx, and never a deal value for a role without value rights. It also asserts the editor's invariants for every live role. The reviewed golden matrices (`accessMatrix*.json`) are for the five platform roles and are regenerated for the new routes by the coordinator (`UPDATE_API_SNAPSHOTS=1`).

### Decisions taken without being asked

1. Custom roles live in `roles` (with RLS) rather than a new table, so names flow into every existing member list and nothing needs a second lookup.
2. `roles.manage` is a new key, Management only, V2 (not folded into `role.assign`), so reading the role list for assignment (`role.assign`) and editing roles stay separate.
3. Reserved keys are a fixed list in code, not configurable per organisation: it is the platform's limit.
4. Only `deal.value` is an editable field rule today (the one masking surface that has a real "owner exception" to tune).
5. A custom role cannot be given `export.bulk` and `audit.view` (they carry approval and audit duties); an organisation that needs them uses Management.

## 2. Churn hints from the assistant (FIG-1190)

A gentle, explainable nudge to the owner of a customer that looks like it may leave. Always reasons in words, never a score alone.

| Piece | Where |
|---|---|
| Rules (pure) | `src/lib/churnSignals.ts` |
| Service: refresh, list, dismiss, feedback | `src/services/churnHintService.ts` |
| Routes | `src/app/api/orgs/[orgSlug]/churn-hints/` (`GET`, `refresh`, `[hintId]/dismiss`, `[hintId]/feedback`) |
| Nightly job | `churn.hints.refresh` in `src/jobs/churnJobs.ts` |
| Table | migration `20261124100000_churn_hints` (`churn_hints`, RLS, one open hint per company) |
| Tests | `tests/churnHints.test.ts` |

### Rules

| Signal | Weight | When |
|---|---|---|
| `renewal_lapsed` | 3 | a recurring service is past its renewal date and grace period |
| `renewal_due_quiet` | 2 | a service renews within the due window and nobody has been in touch for 14 days |
| `service_cancelled` | 2 | a service was cancelled in the last 45 days |
| `no_contact_60` / `no_contact_30` | 3 / 1 | no activity on the customer or its contacts for 60+ / 30 to 59 days (a customer with nothing logged is judged from when it was added) |
| `activity_drop` | 2 | 3 or more activities in the month before last, none in the last 30 days |
| `dormant` | 2 | lifecycle state is Dormant |

A hint needs a total of 2 or more; level: low 2 to 3, medium 4 to 5, high 6 or more. Customers are companies in a customer lifecycle state (Customer, Active, Dormant, Renewal) with an owner, not archived or merged.

### The assistant's walls

- Needs the organisation's `assistant.enabled` toggle **and** the "churn" option (`retention` in Settings, AI assistant, off by default), plus `ai.use` and V2. Off, the list says why and generation does nothing.
- The generator is **rules-based and calls no model**: a hint must be explainable reason by reason, and a viewer's text must be built only from reasons that viewer may see, so it is composed per viewer at read time. The model seam stays free for a later wording step; nothing here depends on `ANTHROPIC_API_KEY`.
- **Never decides (hard rule 9):** a hint can be dismissed or rated and nothing else. A test proves company, deal, tasks, proposals, communications and notifications are unchanged by refreshing, rating and dismissing.

### Masking

Facts are dates and counts only: no deal value, margin, cost, quote amount, invoice or payment is read or stored (a test plants a sentinel deal value and searches the store and every answer). The company's stored health score is not used, because it can include factors a viewer may not see. Each reason records the permission its data needs (`company_services.view` for renewals, `activities.view` for activity, `companies.view` for dormant); a viewer sees only the reasons they may see, and level and sentence are recomputed from those. A hint with nothing visible left is not shown. Who sees a hint at all: the customer's owner and anyone with `reporting.view.all`; anyone else gets 404 on dismiss and feedback.

### Dismiss and feedback

Dismiss (with an optional reason) closes the hint; it is not recreated for the same kinds of trouble (the situation is identified by the set of signal kinds, not by the day counts, which change daily), but a new kind of trouble opens a new one. An open hint keeps its numbers current on each refresh. A hint whose signals clear is closed as RESOLVED, not deleted. Feedback (`HELPFUL` / `NOT_HELPFUL`, optional note) is stored with the hint. Free text from the person passes the assistant's text cleaner. Dismissals, feedback and refreshes that change anything are audited.

### Decisions taken without being asked

1. No model call in the generator (see above); weights and thresholds are fixed in code, not per organisation.
2. The situation of a hint is the set of signal kinds. A dismissed hint stays dismissed until a new kind of trouble appears; a worsening of the same kind (more days quiet) does not bring it back.
3. Management sees every owned customer's hint; there is no separate "hints for everyone" permission.

## 3. Open items for the coordinator and Given

- **Contract.** `V2_OPERATIONS_D` is registered in `src/api/openapi.ts` and `npm run contract:update` was run once (frozen document, typed client, API reference now hold the 11 lane D operations). Still to do once for all lanes: register the other lanes' operation lists, run `UPDATE_API_SNAPSHOTS=1` on `tests/apiWalk.test.ts` and `tests/apiWalkV11.test.ts` (adds matrix rows, hence `x-allowed-roles`, for the new routes), run `npm run contract:update` again, add the `contract-hash:` line and a note to `docs/API_CHANGELOG.md`, and refresh `examples.json`. Until then three `tests/apiContract.test.ts` tests fail (frozen hash line, typed client list after the other lanes' routes, mock server examples for operations without matrix rows).
- **RLS on `roles`.** `roles` carries an organisation id now, so it has the forced `tenant_isolation` policy the stage 2 gate demands (platform roles stay visible to everyone). Like every other forced table it assumes the administrative role bypasses row-level security (a superuser or BYPASSRLS role): the editor writes custom roles through it. True in local Postgres; confirm for the AWS owner role.
- **Test environment.** `tests/v11PermissionDenial.test.ts` (and the other V1.1 world tests) need a global release of at least V1.1 (`ACTIVE_RELEASE=v2`), because the world resolves its role contexts before moving the organisation to V1.1; the V1 matrix tests need `ACTIVE_RELEASE=v1`. Not caused by lane D; found while running both.
- **Export tables.** `roles`, `role_field_rules` and `churn_hints` are classified as excluded from the organisation export (reasons in `src/services/organisationExportTables.ts`). `quote_signatures`, `api_tokens` and the webhook tables of other lanes still need a classification there.
