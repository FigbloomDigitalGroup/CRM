# Release flags and organisation toggles

FIG-1015 (B0.07). The design tags every screen V1, V1.1 or V2; the product has the same switch, evaluated on the server, so unfinished features can be merged safely and released in order.

Code: `src/lib/featureFlags.ts` (definitions and resolution, no database), `src/services/featureService.ts` (loads an organization's values, `requireFeature`, changes). API: `GET` and `PATCH /api/orgs/<org>/features`.

## Two layers

1. **Release flags** `release.v1`, `release.v11`, `release.v2`. A flag is on when the organization's active release is at least that release.
   - The deployment's release is the `ACTIVE_RELEASE` environment variable (`v1`, `v1.1` or `v2`). Unset or unreadable means `v1`.
   - An organization can run a different release from the deployment (a pilot customer ahead of the rest). This is `setOrganizationRelease(orgId, release | null, { userId })`, audited as `release_override.changed`. It is not an HTTP route; it belongs to the platform console (B6), so for now scripts and tests call it.
2. **Organisation toggles** (`TOGGLES` in `featureFlags.ts`): named on/off switches with a default and a `minRelease`.
   - A toggle only counts once the organization's release has reached `minRelease`: a V1.1 feature stays off in V1 whatever its saved value says, and cannot be changed yet.
   - Until Management saves a value, the default applies.
   - Saved values live in `OrganizationSetting` under `feature_toggles`; the release override under `release_override`.

| Toggle | First release | Default | What it controls |
|---|---|---|---|
| `integrations.enabled` | V1 | on | Integrations (click-to-chat, website capture) |
| `personalisation.allowed` | V1 | on | Members choosing their own theme and page colours |
| `preferences.own_colours` | V1.1 | on | Members picking their own accent and page colours (B1.08). Needs `personalisation.allowed`; checked only for the colour fields actually sent |
| `permissions.provisional_departures` | V1 | on | Umbrella over the five signed departures from the permission matrix; off switches all five off and falls back to the seeded matrix |
| `departure.won_only` | V1 | on | Delivery and Finance see won deals only (decision 1.2). Off: they see every deal again (`deals.view.all`) |
| `departure.shared_pool` | V1 | on | Sales sees unassigned leads read-only and may claim them (decision 1.3) |
| `departure.technical_my_work` | V1 | on | Restricted Technical gets My work: tasks plus the client requirements on them (decision 1.4) |
| `departure.finance_followup` | V1 | on | Finance adds a follow-up note on won deals instead of tasks (decision 1.5) |
| `departure.handoff_permission` | V1 | on | The delivery-handoff permission: Management and Sales start, Delivery receives (decision 1.6) |
| `assistant.enabled` | V1.1 | off | The Ask Figbloom assistant |
| `organisation.switcher` | V1.1 | on | The multi-organisation switcher |
| `quotes.enabled` | V1.1 | on | Quotes, approvals, forecast |
| `customer_support.role` | V1.1 | off | The Customer Support role (decision-gated) |

## Gating a route or service

```ts
const ctx = await resolveRequestContext(orgSlug);
await requireFeature(ctx.organizationId, "quotes.enabled");
```

`requireFeature` throws `FeatureUnavailableError`; `handleRoute` returns the explained response:

```json
{
  "code": "FEATURE_UNAVAILABLE",
  "message": "This feature is not available yet. It is planned for V1.1.",
  "feature": { "key": "quotes.enabled", "reason": "release", "availableIn": "V1.1" }
}
```

with status 403. When an organization switched the feature off, `reason` is `toggle`, `availableIn` is null and the message tells them to ask their Management users.

Services that only need a yes or no use `isFeatureEnabled(orgId, key)`. An unknown key is always off.

## Navigation and the UI

`GET /api/orgs/<org>/features` (any member) returns the organization's `release`, every flag resolved to on/off in `flags`, and the toggle list with defaults, saved values and whether each is `available` yet. The shell hides navigation items and screens whose flag is off; the typed client (F1.06) will wrap this.

## Changing a toggle

`PATCH /api/orgs/<org>/features` with `{ "toggles": { "<key>": true | false } }`. Needs `organization.manage_settings` (Management). An unknown key, a non-boolean, or a toggle whose release has not arrived is a 400. Every real change writes a `feature_toggle.changed` audit event with the old and new value.

## Adding a feature flag

1. Add the toggle to `TOGGLES` (key, description, default, `minRelease`).
2. Gate its routes with `requireFeature` and its navigation with `flags[key]`.
3. Test it on and off (`tests/featureFlags.test.ts` shows the pattern).

## Departures from the permission matrix (B1.03)

Each departure is effective only while both the umbrella toggle and its own toggle are on. When a departure is off, the keys it introduced are removed from the affected roles and the keys the seeded matrix gave them are put back, so "off" means the old behaviour exactly. The member's effective keys (`ActiveMembership.permissionKeys`) already reflect this; nothing downstream checks a flag or a role name.

Where a departure applies, the record payload carries `provisional: true` next to `scope` so the UI can show the "Provisional" banner; the decision reference lives with the definition in `src/auth/permissions.ts` (`DEPARTURES`).

## Customer Support (B1.01)

`customer_support.role` gates the sixth role. While it is off, Customer Support cannot be invited or assigned (a validation error names the flag), and a member who somehow holds it carries no permissions. Turning it on needs the organization to be on V1.1 or later.
