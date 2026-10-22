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
| `permissions.provisional_departures` | V1 | on | The five signed departures from the permission matrix; off falls back to the seeded matrix (read by B1.03) |
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
