# OAuth connections for email and calendar (FIG-1153, B6.21)

The framework behind mail sync (`docs/MAIL_AND_CALENDAR_SYNC.md`) and meeting links. It connects a person's own Google or Microsoft account, or, if Management decides so, one shared organisation mailbox or calendar.

## Pieces

| Piece | Where |
|---|---|
| Tables `oauth_connections`, `oauth_states` (RLS, composite tenant FKs) | `prisma/migrations/20261110090000_oauth_connections` |
| Encryption at rest (AES-256-GCM, key `INTEGRATION_ENCRYPTION_KEY`) | `src/lib/secretBox.ts` |
| Provider seam, scopes, errors | `src/integrations/oauth/types.ts` |
| Real Google and Microsoft clients (authorization code with PKCE, refresh, revoke) | `src/integrations/oauth/providers.ts` |
| Service: start, complete, list, disconnect, settings, token lifecycle | `src/services/oauthConnectionService.ts` |
| Job `oauth.refresh` (every 30 minutes, per organisation) | `src/jobs/integrationJobs.ts` |

## Rules

- **Tokens are secrets.** Access and refresh tokens and the PKCE verifier are stored only as `v1.<nonce>.<tag>.<ciphertext>`. No API answer, audit event or log line carries one. Without `INTEGRATION_ENCRYPTION_KEY` (base64 of 32 bytes) nothing is stored: it fails closed.
- **Least privilege.** Per provider and purpose (`SCOPES`): Google mail `gmail.readonly` + `gmail.send`, Google calendar `calendar.events` + `calendar.calendarlist.readonly`; Microsoft mail `Mail.Read` + `Mail.Send`, Microsoft calendar `Calendars.ReadWrite`. A mail connection cannot touch a calendar and the other way round. Meeting links (Meet, Teams) come with the events scope.
- **One-time state.** The `state` is random, stored hashed, bound to the person and organisation that started it, valid 10 minutes, usable once (an atomic update claims it). Any mismatch gives the same refusal.
- **Refresh and revoke.** `getAccessToken` refreshes when less than 2 minutes remain. A provider that refuses the refresh token for good (`invalid_grant`) moves the connection to NEEDS_RECONNECT and no more attempts are made until the person connects again. A passing failure only records `last_error`. Disconnect revokes at the provider (best effort), wipes both tokens and the sync cursor, sets REVOKED; every sync and send entry point calls `getUsableConnection`, which refuses anything that is not CONNECTED, so sync stops at once.
- **Status for the screens.** `GET .../integrations/connections` returns, per kind, CONNECTED, NEEDS_RECONNECT or DISCONNECTED with a plain-language reason (and `ConnectionUnavailableError` carries the same state on a send or schedule), so Mail and Video can show a clear disconnected state.
- **Per person, plus an optional shared mailbox.** A person sees and disconnects only their own connection; Management (`configuration.manage`) lists every live connection and may revoke any (a leaver's, the shared one). Only Management starts a shared connection (`shared: true`). A person's own connection wins over the shared one when sending.
- Permissions reuse existing keys: email needs `communications.create`, calendar `activities.create`; the feature toggle `integrations.enabled` gates it.

## API

| Route | What |
|---|---|
| `POST /api/orgs/{org}/integrations/connections/start` | `{kind, provider, shared?}` returns the provider sign-in address |
| `GET /api/integrations/oauth/callback` | the one fixed redirect address to register with Google and Microsoft: finds the organisation from the `state`, requires the session that started it, redirects to `Settings, Email & calendar` |
| `GET /api/orgs/{org}/integrations/connections` | the person's status per kind |
| `GET /api/orgs/{org}/integrations/connections/organization` | Management: every live connection |
| `PATCH` / `DELETE .../connections/{id}` | settings (calendar chosen, mail exclusion list, `syncEnabled`, `syncTasks`) / disconnect |
| `POST .../connections/{id}/sync`, `GET .../connections/{id}/calendars` | sync now (queued), list the provider's calendars |

## Setup for a deployment

`GOOGLE_OAUTH_CLIENT_ID/SECRET`, `MICROSOFT_OAUTH_CLIENT_ID/SECRET` (optional `MICROSOFT_OAUTH_TENANT`), `INTEGRATION_ENCRYPTION_KEY`, `APP_BASE_URL`; register `${APP_BASE_URL}/api/integrations/oauth/callback` as the redirect address. See `.env.example`.

**A provider with no client id and secret (D-2, MVP-16 smoke test, 11 Nov 2026).** `POST /integrations/connections/start` answers `503` with code `SERVICE_UNAVAILABLE` and a plain message ("Google sign-in is not set up for this organisation yet. Ask your administrator to set it up, or try the other provider."), stores no sign-in state, and names no variable. The screens show that message instead of the generic failure text. The V1 contract's code list is unchanged.

## Screen to wire

`src/ui/screens/assistant/settings/Connections.tsx` (Settings, Email & calendar) is wired to the real API since 9 Nov 2026 (MVP-12, FIG-1551): `start` (opens the provider's own sign-in), the status call and `DELETE`. Mail and Video (`src/ui/screens/communication/api.ts`, `useConnection`) read the status and start the connection. Not yet tried end to end against a real Google or Microsoft account (needs the OAuth keys).

## Tests

`tests/oauthConnections.test.ts`: encryption and tamper, ciphertext in the database and absent from every answer and the audit trail, scopes, state reuse/expiry/other person/other organisation, refresh, NEEDS_RECONNECT, revoke stops sync, ownership and cross-organisation, the refresh job for one organisation only, RLS as the application role, and the real provider clients against a fake provider server.
