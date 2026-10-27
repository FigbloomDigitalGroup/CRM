# Offline sync, push and quick capture (FIG-1064, FIG-1065, B4.07, B4.08)

## Quick capture

`POST /quick-capture`: name, phone (or email), service, source, note, and an optional follow-up task, in one call. Defaults: the caller owns it, status New, source the caller used last
(else Physical Meeting, else the first source). A company name that exists is linked; one that does not stays in the note (it does not invent a company).

A likely duplicate (a contact with the same email, phone number or name) answers **200 `DUPLICATE_WARNING`** and creates nothing. Send the same body again with `duplicateDecision`:
`OPEN_EXISTING` (returns the record), `CREATE_ANYWAY`, or `MERGE` (adds the note and follow-up to the existing lead or contact and fills in only what is missing). Send an `Idempotency-Key`.

Speed: a capture makes a fixed 14 database transactions however much data exists (tested), about 150 to 250 ms server side on the Windows and Docker development database, where each transaction is slow;
the 300 ms p95 round trip on a mobile network is measured against staging in G1.04.

## Offline sync

`POST /sync/batch` takes up to 100 queued actions, each with a **client id** the phone invented. Every item is answered `APPLIED`, `DUPLICATE`, `CONFLICT` or `REJECTED` with a reason a person can read.

| Kind | What | Offline? |
|---|---|---|
| QUICK_CAPTURE | A lead captured in the field (a duplicate is a CONFLICT to resolve later) | yes |
| CALL_LOG, WHATSAPP_LOG | A call or chat, same rules as the quick log | yes |
| NOTE_ADD | A note on a lead, contact, company or deal | yes |
| TASK_CREATE, TASK_COMPLETE | A task | yes |
| STAGE_CHANGE, OWNER_CHANGE | Pipeline and ownership | **never applied** |

**Conflict rules.** Notes and logs are append-only, so the latest write wins by construction, and each carries the time the person made it. The server always wins on stage and ownership: a stale
change answers CONFLICT with what the server has (`serverState`); a current one is refused ("open the deal online"), because the pipeline is read-only offline (design M2). Everything else uses the same permissions as the online action.

**Replay is safe.** A client id is claimed (unique per person) before its action runs, so the same batch twice, or two requests racing, applies each action once and answers DUPLICATE with the first answer.
A claim left by a request that died is taken over after two minutes. Items run in the order the person made them (`clientCreatedAt`, never in the future), and a later item may name an earlier one with
`"ref:<clientId>"` in place of a record id. `GET /sync/status` shows the last sync, the last seven days and what needs attention. History is kept 90 days (retention).

## Push (Web Push)

`GET /push/config` says whether push is on (needs `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`) and gives the public key. `POST /push/subscriptions` registers a device; the endpoint must be https on a real push
service (Google, Mozilla, Microsoft, Apple; `PUSH_EXTRA_HOSTS` adds more) because the server calls it. A person sees and removes only their own devices.

A notification is pushed when the person has a device and has turned push on for that type (Preferences; it cannot be turned on without a device and a configured server). It stays quiet during their quiet hours
(the in-app notification is still there), redacts money for roles that may not see it, and revokes a device the push service says is gone (404/410) or that fails five times in a row. It never fails the action that raised it.

## PWA

`GET /pwa/manifest` is the organisation's own manifest (its name and colours). `GET /pwa/version` returns the **cache version**, a fingerprint of the build, release, the organisation's look and its toggles; a different
number means refresh. It also says what may be queued offline and what the server always decides.
