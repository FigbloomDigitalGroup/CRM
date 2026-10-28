# M8 record extras (F3.08, FIG-1102)

Design: X1, `design-spec/CrmRecordExtras.dc.html`. Code: `src/ui/screens/extras/`, stylesheet `extras.css` (imported by `ui.css`).

## Use

```tsx
<RecordExtras kind="lead" | "contact" | "company" | "deal" id={recordId} archived={isArchived} />
```

One component, one behaviour on all four record types. `src/ui/screens/extras/kinds.ts` is the only place that knows the API's per-record operation names (`getLeadsByLeadIdTags`, `getCompaniesByCompanyIdComments`, ...). The optional `showScore={false}` hides the lead score card on a screen that already explains the score (the lead page has "Why this score").

Mounted on `LeadDetailScreen` (score card off) and `DealDetailScreen`. The Customer 360 and the contact page mount it themselves.

## What it shows

| Part | API | Behaviour |
|---|---|---|
| Lead score (leads) | `getLeadsByLeadIdScore` | number, band in words, factors with points |
| Customer health (companies) | `getCompaniesByCompanyIdHealth` | band, score, factors (the API already hides payment factors from other roles) |
| Follow (all) | `...Follow` (POST/DELETE); state comes with the comments read | pressed button, disabled when archived |
| Tags | record tags, `getTags`, `...Tags` (PATCH) | add existing; create new only with `tags.manage`; remove with 5 s Undo |
| Custom fields | `getCustomFields` (GENERAL section), the record's `customFields`, the record's PATCH | typed input per field type (text, number, date, dropdown, multi-select, yes/no); required and type checks before sending; server field messages shown beside the field; saved on leaving the field; Undo toast |
| Attachments | `...Attachments` (POST returns a signed link), `PUT` to the link, `.../complete`, download link, DELETE | type and size rules checked first (25 MB; PDF, images, Word, Excel, PowerPoint, CSV, text); "Scanning…" polls every 2 s until READY; Quarantined is explained; Preview by short-lived link; delete with 5 s Undo (offered to the uploader or `configuration.manage`) |
| Internal comments | `...Comments`, `...CommentsMentionable`, `editComment`, `deleteCommentsByCommentId` | plain text up to 5000; typing `@` offers people who can open the record; mentions are sent as membership ids; edit and delete follow the API's `canEdit` and `canDelete`; delete with Undo |

A part the API refuses (403/404) says so in place ("Comments aren’t available to your role on this company."); it is never silently missing. An archived record shows a banner and every control is read-only.

## Decisions taken without asking

1. **Release badges (V1, V1.1, V2) are not shown.** They label the prototype, not the product. Score override, "Win likelihood" on deals, cadence and the follower count have no V1 endpoint and are not shown.
2. **Undo for deletes is deferred, not reversed.** The API has no restore for a comment, attachment or tag removal, so the item hides at once, the Undo toast stays 5 s, and the delete is sent only when it expires (or when the panel closes). Undo therefore always works.
3. **Uploader names** are not in the attachments response; own files say "You", others show size and date only.
4. **The prototype's "Try a 40 MB file" demo button and the "N file(s) restricted" line are not built.** The API filters restricted files silently, so a count is not known. On deals, a file not shared with roles that cannot see the deal value is marked.
5. **The bytes upload** needs one non-API request; `putSignedUpload` was added to `src/ui/data/client.ts` (the one file allowed to call `fetch`). M9's profile picture can reuse it.
6. Custom fields tied to a service show on leads and deals of that service only; on contacts and companies all active fields show.

## Tests

`tests/components/screens/extras/recordExtras.test.tsx` (42 tests: all four kinds on tags, fields, files, comments and follow; score and health; mention flow; upload limits and refusals; scan status; preview; delete with Undo; read-only archived; no-access notes; axe on every kind), run with `vitest.extras-components.config.ts` (no database). `e2e/record-extras.spec.ts` (upload, scan, preview, size refusal, mention, tag) is written and not yet run (needs Docker and the dev server).

## Known gaps

No score override, no follower count, no uploader name on other people's files, no cadence. Upload runs one file at a time.
